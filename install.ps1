# Install the published Windows app; compatible with Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Este instalador exige Windows.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'O Onda exige Windows de 64 bits.' }
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = if ($architecture -eq 'ARM64') { 'arm64' } elseif ($architecture -eq 'AMD64') { 'x64' } else { throw "Arquitetura Windows nao suportada: $architecture" }
$file = "onda-setup-$arch.exe"
$base = 'https://github.com/sqjoao/Music/releases/latest/download'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('onda-install-' + [Guid]::NewGuid().ToString('N'))
$previousProgress = $ProgressPreference
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $ProgressPreference = 'SilentlyContinue'
    Write-Host 'Baixando a ultima versao publicada do Onda...'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $temporary 'SHA256SUMS')
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile (Join-Path $temporary $file)
    } catch { throw "Nao foi possivel baixar o instalador. Verifique a internet e se a primeira release terminou em https://github.com/sqjoao/Music/releases . $($_.Exception.Message)" }
    $lines = @(Get-Content (Join-Path $temporary 'SHA256SUMS') | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($file) + '$') })
    if ($lines.Count -ne 1) { throw 'A lista de checksums nao contem exatamente um instalador compativel.' }
    $expected = ($lines[0] -split '\s+')[0]
    $actual = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $temporary $file)).Hash
    if ($actual -ne $expected) { throw 'Checksum incorreto. O instalador nao sera executado.' }
    Write-Host 'Checksum confirmado. Instalando para o usuario atual...'
    $process = Start-Process -FilePath (Join-Path $temporary $file) -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "O instalador terminou com codigo $($process.ExitCode)." }
    Write-Host 'Onda instalado. Abra pelo menu Iniciar ou pelo atalho na area de trabalho.'
} finally {
    $ProgressPreference = $previousProgress
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
