# Deployt admin-worker.js per Cloudflare-API statt per Copy-Paste ins Dashboard.
#
# Warum: der Dashboard-Weg hat am 2026-07-14 alle "02_Foerderung"-Pfade als
# als Mojibake deployt
# ANSI) -> saemtliche Dashboard-Quoten fielen auf 0. Hier gehen die Datei-Bytes
# unveraendert raus, der Fehlermodus ist strukturell ausgeschlossen.
#
# Voraussetzung: API-Token mit "Account -> Workers Scripts -> Edit",
# uebergeben als Umgebungsvariable (NIE ins Skript schreiben, Repo ist oeffentlich):
#   $env:CF_API_TOKEN = "..."
# Optional, sonst automatisch ermittelt:
#   $env:CF_ACCOUNT_ID = "..."
#
# Aufruf:
#   .\deploy-worker.ps1              # nur analysieren, KEIN Schreibzugriff
#   .\deploy-worker.ps1 -Deploy      # Backup ziehen + hochladen + Gesundheitsprobe

[CmdletBinding()]
param(
  [string]$Skript = 'landingpage',
  [string]$Datei,
  [string]$ProbeUrl = 'https://landingpage.michel-brunner.workers.dev',
  [switch]$Deploy,
  [switch]$KeinBackup
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Datei) { $Datei = Join-Path $PSScriptRoot 'admin-worker.js' }
$API = 'https://api.cloudflare.com/client/v4'

function Schritt($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text)      { Write-Host "   [ok]   $text" -ForegroundColor Green }
function Warn($text)    { Write-Host "   [warn] $text" -ForegroundColor Yellow }
# Sauberer Abbruch statt throw - throw druckt in PS 5.1 einen Stacktrace, den hier niemand braucht.
function Abbruch($text) { Write-Host "`n!! $text`n" -ForegroundColor Red; exit 1 }

function CfCall {
  param([string]$Pfad, [string]$Methode = 'GET', $Body, [switch]$Roh)
  $kopf = @{ Authorization = "Bearer $env:CF_API_TOKEN" }
  # NICHT $args nennen - das ist eine automatische Variable und wird beim Splatten stillschweigend falsch aufgeloest.
  $anfrage = @{ Uri = "$API$Pfad"; Method = $Methode; Headers = $kopf; UseBasicParsing = $true }
  if ($Body) { $anfrage.Body = $Body; $anfrage.ContentType = 'application/json' }
  try {
    $antwort = Invoke-WebRequest @anfrage
    if ($Roh) { return $antwort.Content }
    return ($antwort.Content | ConvertFrom-Json)
  } catch {
    # PS 5.1: der Fehler-Body steht in ErrorDetails, nicht im Response-Stream.
    $detail = $_.ErrorDetails.Message
    $code   = $_.Exception.Response.StatusCode.value__
    throw "Cloudflare-API $Methode $Pfad -> HTTP $code`n$detail"
  }
}

# ---------------------------------------------------------------- 1. Token
Schritt 'Token pruefen'
if (-not $env:CF_API_TOKEN) {
  Abbruch 'CF_API_TOKEN ist nicht gesetzt. Token anlegen (dash.cloudflare.com -> My Profile -> API Tokens), dann:  $env:CF_API_TOKEN = "..."'
}
$pruef = CfCall '/user/tokens/verify'
if (-not $pruef.success) { Abbruch 'Token ist ungueltig oder abgelaufen.' }
Ok "Token aktiv (Status: $($pruef.result.status))"

# ------------------------------------------------------------- 2. Account
Schritt 'Account ermitteln'
$accountId = $env:CF_ACCOUNT_ID
if ($accountId) {
  Ok "aus CF_ACCOUNT_ID: $accountId"
} else {
  $konten = (CfCall '/accounts').result
  if (-not $konten -or $konten.Count -eq 0) { Abbruch 'Kein Account lesbar. Entweder CF_ACCOUNT_ID setzen oder dem Token Account-Leserecht geben.' }
  if ($konten.Count -gt 1) {
    Warn "Mehrere Accounts gefunden - nehme den ersten. Sonst CF_ACCOUNT_ID setzen:"
    $konten | ForEach-Object { Write-Host "          $($_.id)  $($_.name)" }
  }
  $accountId = $konten[0].id
  Ok "$accountId  ($($konten[0].name))"
}

# ------------------------------------------------------- 3. Lokale Datei
Schritt 'Lokale Datei pruefen'
if (-not (Test-Path $Datei)) { Abbruch "Datei nicht gefunden: $Datei" }
$bytes = [System.IO.File]::ReadAllBytes($Datei)
$text  = [System.Text.Encoding]::UTF8.GetString($bytes)

if ($bytes.Length -lt 50KB)            { Abbruch "Datei ist nur $([math]::Round($bytes.Length/1KB,1)) KB - sieht abgeschnitten aus, Abbruch." }
if ($text -notmatch 'export default')  { Abbruch 'Kein "export default" gefunden - das ist kein Modul-Worker, Abbruch.' }
# Mojibake = UTF-8-Bytes als Latin-1 gelesen. Das ergibt IMMER U+00C3 gefolgt von
# einem Zeichen aus U+0080..U+00BF. Bewusst als Codepoint-Vergleich statt als
# literales Suchmuster: ein literales Mojibake-Muster wird beim naechsten Encoding-
# Wechsel der Datei selbst zerstoert - genau das ist beim ersten Entwurf dieses
# Skripts passiert, die Pruefung war danach blind.
function HatMojibake([string]$s) {
  for ($i = 0; $i -lt $s.Length - 1; $i++) {
    if ([int]$s[$i] -eq 0xC3) {
      $folge = [int]$s[$i + 1]
      if ($folge -ge 0x80 -and $folge -le 0xBF) { return $true }
    }
  }
  return $false
}
if (HatMojibake $text) { Abbruch 'Mojibake in der Datei (doppelt kodiertes UTF-8). NICHT deployen, erst die Datei reparieren.' }

$umlaute = ([regex]::Matches($text, "[äöüÄÖÜß]")).Count
Ok "$([math]::Round($bytes.Length/1KB,1)) KB, $((($text -split "`n").Count)) Zeilen, $umlaute Umlaute intakt"

# ------------------------------------------- 4. Live-Einstellungen lesen
Schritt 'Aktuelle Worker-Einstellungen lesen'
$settings = (CfCall "/accounts/$accountId/workers/scripts/$Skript/settings").result

$bindings = @($settings.bindings)
if ($bindings.Count -eq 0) {
  Warn 'Keine Bindings gemeldet - falls der Worker Secrets hat, Token-Rechte pruefen BEVOR deployed wird.'
} else {
  Ok "$($bindings.Count) Bindings vorhanden:"
  $bindings | ForEach-Object { Write-Host "          $($_.name)  [$($_.type)]" }
}
$bindingTypen = @($bindings | ForEach-Object { $_.type } | Sort-Object -Unique)

# compatibility_date liegt je nach API-Version in settings oder im Script-Objekt.
$compatDate = $settings.compatibility_date
if (-not $compatDate) { $compatDate = (CfCall "/accounts/$accountId/workers/scripts/$Skript").result.compatibility_date }
$compatFlags = @($settings.compatibility_flags)
Ok "compatibility_date: $compatDate   flags: $(if ($compatFlags.Count) { $compatFlags -join ',' } else { '(keine)' })"

if (-not $Deploy) {
  Write-Host "`n-- Analyse-Modus, nichts geschrieben. Zum echten Deploy:  .\deploy-worker.ps1 -Deploy" -ForegroundColor Magenta
  return
}

# ------------------------------------------------------------ 5. Backup
if (-not $KeinBackup) {
  Schritt 'Backup des Live-Stands'
  $sicherung = Join-Path $PSScriptRoot ("backup-worker-{0}.js" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $live = CfCall "/accounts/$accountId/workers/scripts/$Skript/content" -Roh
  [System.IO.File]::WriteAllText($sicherung, $live, (New-Object System.Text.UTF8Encoding($false)))
  Ok "gesichert: $sicherung  ($([math]::Round((Get-Item $sicherung).Length/1KB,1)) KB)"
  if ($live -eq $text) { Warn 'Live-Stand ist BYTEGLEICH mit der lokalen Datei - der Deploy ist ein No-Op.' }
}

# ------------------------------------------------------------ 6. Upload
Schritt 'Hochladen'
$dateiName = Split-Path $Datei -Leaf
# Secrets und uebrige Bindings unangetastet lassen - ohne keep_bindings loescht der PUT sie.
# @(...) erzwingen, sonst wird ein Ein-Element-Array beim JSON-Bau zum Skalar.
$behalten = @(if ($bindingTypen.Count) { $bindingTypen } else { 'secret_text', 'plain_text' })
$metadata = @{
  main_module   = $dateiName
  keep_bindings = $behalten
}
if ($compatDate)        { $metadata.compatibility_date  = $compatDate }
if ($compatFlags.Count) { $metadata.compatibility_flags = @($compatFlags) }
$metaJson = $metadata | ConvertTo-Json -Depth 5 -Compress
Write-Host "   metadata: $metaJson"

$grenze = "----claude$([guid]::NewGuid().ToString('N'))"
$strom  = New-Object System.IO.MemoryStream
function Schreib([string]$s) { $b = [System.Text.Encoding]::UTF8.GetBytes($s); $strom.Write($b, 0, $b.Length) }

Schreib "--$grenze`r`n"
Schreib "Content-Disposition: form-data; name=`"metadata`"`r`n"
Schreib "Content-Type: application/json`r`n`r`n"
Schreib "$metaJson`r`n"
Schreib "--$grenze`r`n"
Schreib "Content-Disposition: form-data; name=`"$dateiName`"; filename=`"$dateiName`"`r`n"
Schreib "Content-Type: application/javascript+module`r`n`r`n"
$strom.Write($bytes, 0, $bytes.Length)   # Datei-Bytes 1:1, keine Umkodierung
Schreib "`r`n--$grenze--`r`n"

$ergebnis = Invoke-WebRequest -Uri "$API/accounts/$accountId/workers/scripts/$Skript" `
  -Method PUT -Headers @{ Authorization = "Bearer $env:CF_API_TOKEN" } `
  -ContentType "multipart/form-data; boundary=$grenze" -Body $strom.ToArray() -UseBasicParsing
$strom.Dispose()

$json = $ergebnis.Content | ConvertFrom-Json
if (-not $json.success) { Abbruch "Upload abgelehnt: $($ergebnis.Content)" }
Ok "deployed - Stand vom $($json.result.modified_on)"

# ------------------------------------------------- 7. Gesundheitsprobe
Schritt 'Gesundheitsprobe gegen den Live-Worker'
function Probe($body) {
  try {
    $r = Invoke-WebRequest -Uri $ProbeUrl -Method POST -ContentType 'application/json' `
           -Body ($body | ConvertTo-Json -Compress) -UseBasicParsing
    return @{ code = $r.StatusCode; text = $r.Content }
  } catch {
    return @{ code = $_.Exception.Response.StatusCode.value__; text = $_.ErrorDetails.Message }
  }
}
Start-Sleep -Seconds 2

$faelle = @(
  @{ name = '400 unbekannte Aktion'; body = @{ action = 'claude-kontrolle-nicht-existent' };                              erwartet = 400 },
  @{ name = '401 ohne Token';        body = @{ action = 'me' };                                                           erwartet = 401 },
  @{ name = '403 Passwort-Scope';    body = @{ action = 'verify-action-password'; scope = 'checkliste-sperre'; password = 'absichtlich-falsch' }; erwartet = 403 }
)
$fehler = 0
foreach ($f in $faelle) {
  $a = Probe $f.body
  if ($a.code -eq $f.erwartet) { Ok "$($f.name): $($a.code)" }
  else { Warn "$($f.name): erwartet $($f.erwartet), bekommen $($a.code) $($a.text)"; $fehler++ }
}

if ($fehler -gt 0) {
  Write-Host "`n!! Gesundheitsprobe fehlgeschlagen. Rueckfall: Backup-Datei oben ins Dashboard einfuegen." -ForegroundColor Red
  exit 1
}
Write-Host "`n-- Fertig. Worker antwortet in allen drei Fehlerklassen korrekt." -ForegroundColor Green
Write-Host "   Das beweist einen intakten Deploy, NICHT das Verhalten der drei" -ForegroundColor DarkGray
Write-Host "   Kadermanager-/Cache-Commits - die brauchen einen echten E2E-Test." -ForegroundColor DarkGray
