# Installs or upgrades the Spectron CLI on Windows (PowerShell 5.1 or 7):
#
#   irm https://app.spectron.dev/cli/install.ps1 | iex
#
# The Spectron server fills in its own address and the CLI's checksum when it
# serves this file, so the CLI signs in to that server by default and a
# damaged download is refused. Needs Node.js 22 or later.
#
# Installs to %LOCALAPPDATA%\Programs\spectron, with a spectron.cmd launcher
# in its bin folder, which is added to your user PATH. SPECTRON_INSTALL_DIR
# changes the location; SPECTRON_NO_MODIFY_PATH=1 leaves PATH alone.
#
# Everything is inside one script block, run on the last line, so a download
# that is cut short is a parse error and runs nothing. Failures throw rather
# than exit, which would close the window `iex` runs in.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $server = __SPECTRON_SERVER__
  $checksum = '__SPECTRON_SHA256__'

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'The Spectron CLI needs Node.js 22 or later. Install it from https://nodejs.org, then run this again.'
  }
  $nodeVersion = (& node -p 'process.versions.node').Trim()
  if ([int]($nodeVersion.Split('.')[0]) -lt 22) {
    throw "The Spectron CLI needs Node.js 22 or later, and this is v$nodeVersion. Upgrade Node.js, then run this again."
  }

  $installDir = $env:SPECTRON_INSTALL_DIR
  if (-not $installDir) {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA isn''t set. Set SPECTRON_INSTALL_DIR to choose where to install.' }
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\spectron'
  }
  # Relative to the shell's current location, not the process's start directory.
  $installDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($installDir)
  $binDir = Join-Path $installDir 'bin'
  $target = Join-Path $installDir 'spectron.mjs'
  $meta = Join-Path $installDir 'install.json'
  $launcher = Join-Path $binDir 'spectron.cmd'
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  foreach ($path in @($target, $meta, $launcher)) {
    if (Test-Path -LiteralPath $path -PathType Container) {
      throw "$path is a directory. Remove it, or choose another location with SPECTRON_INSTALL_DIR."
    }
  }

  # Staged in a folder of its own and checked before replacing anything, so a
  # failure at any step leaves a working install as it was.
  $stage = Join-Path $installDir ('.staging-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  try {
    Write-Host "Downloading the Spectron CLI from $server"
    $part = Join-Path $stage 'spectron.mjs'
    # Windows PowerShell 5.1 on an older .NET may not offer TLS 1.2. Add it only
    # then (SystemDefault, 0, lets the OS choose), and only for this download.
    $protocols = [Net.ServicePointManager]::SecurityProtocol
    try {
      if ([int]$protocols -ne 0 -and -not ($protocols -band [Net.SecurityProtocolType]::Tls12)) {
        [Net.ServicePointManager]::SecurityProtocol = $protocols -bor [Net.SecurityProtocolType]::Tls12
      }
      # No redirects: the address is exactly the server that served this.
      # The system proxy applies, as it did for this script.
      Invoke-WebRequest -Uri "$server/cli/spectron.mjs" -OutFile $part -UseBasicParsing -MaximumRedirection 0
    } catch {
      throw "Couldn't download $server/cli/spectron.mjs: $($_.Exception.Message)"
    } finally {
      [Net.ServicePointManager]::SecurityProtocol = $protocols
    }
    # .NET rather than Get-FileHash: 5.1 loads that from a module file, which a
    # PSModulePath inherited from PowerShell 7 hides.
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($part)
    try { $hash = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally { $stream.Dispose(); $sha256.Dispose() }
    if ($hash -ne $checksum) {
      throw 'The download doesn''t match its checksum, so nothing was installed. Run the install command again.'
    }
    $version = (& node $part --version)
    if ($LASTEXITCODE -ne 0) {
      throw "The downloaded CLI doesn't run with this Node.js (v$nodeVersion), so nothing was installed."
    }
    # The CLI reads install.json beside itself: auth login signs in here unless told otherwise.
    # WriteAllText writes UTF-8 without a byte-order mark, which JSON.parse needs.
    [IO.File]::WriteAllText((Join-Path $stage 'install.json'), (ConvertTo-Json @{ url = $server } -Compress) + "`n")
    # Finds node on PATH at run time, never in the current folder (where cmd
    # looks first), and passes every argument through.
    [IO.File]::WriteAllText((Join-Path $stage 'spectron.cmd'), (@(
      '@echo off'
      'setlocal'
      'set NoDefaultCurrentDirectoryInExePath=1'
      'node "%~dp0..\spectron.mjs" %*'
    ) -join "`r`n") + "`r`n")

    # The CLI and install.json change together: if either can't be replaced
    # (a file in use), the previous CLI is put back.
    $previous = Join-Path $stage 'previous.mjs'
    $hadPrevious = Test-Path -LiteralPath $target -PathType Leaf
    if ($hadPrevious) {
      try { Move-Item -LiteralPath $target -Destination $previous }
      catch { throw "Couldn't replace $target, so nothing was installed: $($_.Exception.Message)" }
    }
    try {
      Move-Item -LiteralPath $part -Destination $target
      Move-Item -Force -LiteralPath (Join-Path $stage 'install.json') -Destination $meta
    } catch {
      $reason = $_.Exception.Message
      if ($hadPrevious) {
        Remove-Item -Force -LiteralPath $target -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $previous -Destination $target
      }
      throw "Couldn't finish installing, so the previous version was kept: $reason"
    }
    Move-Item -Force -LiteralPath (Join-Path $stage 'spectron.cmd') -Destination $launcher
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue
  }

  Write-Host "Installed spectron $version`: $launcher"
  $onWindows = $env:OS -eq 'Windows_NT'
  if ($onWindows -and $env:SPECTRON_NO_MODIFY_PATH -ne '1') {
    $isBin = { param($entry) [Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\') -ieq $binDir }
    # First in the user PATH, moved there if it was further down, so an
    # older spectron (an npm install) can't win. Read and written raw,
    # keeping it an expandable string: entries such as %USERPROFILE%\bin
    # must stay unexpanded.
    $key = Get-Item -LiteralPath 'HKCU:\Environment'
    $userPath = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $entries = @($userPath.Split(';') | Where-Object { $_ })
    $wanted = (@($binDir) + @($entries | Where-Object { -not (& $isBin $_) })) -join ';'
    if ($wanted -ne ($entries -join ';')) {
      Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name Path -Type ExpandString -Value $wanted
      # Setting and removing a user variable through .NET tells open programs
      # (Explorer, new terminals) that the environment changed. NullString,
      # because PowerShell 7.5+ turns $null into an empty string here.
      [Environment]::SetEnvironmentVariable('SPECTRON_INSTALL_REFRESH', '1', 'User')
      [Environment]::SetEnvironmentVariable('SPECTRON_INSTALL_REFRESH', [NullString]::Value, 'User')
      Write-Host ''
      Write-Host "Put $binDir first in your user PATH. Open a new terminal to use spectron there."
    }
    # First in this window too, so the next command runs this CLI.
    $env:Path = (@($binDir) + @($env:Path.Split(';') | Where-Object { $_ -and -not (& $isBin $_) })) -join ';'
    $found = Get-Command spectron -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found -and $found.Source -ine $launcher) {
      Write-Host ''
      Write-Host "spectron here runs $($found.CommandType) $($found.Name) ($($found.Source)), not this install. Remove it, or run $launcher."
    }
  }
  Write-Host ''
  Write-Host 'Next: spectron auth login'
}
