[Setup]
AppName=Project Manager
AppVersion=1.0
DefaultDirName={autopf}\ProjectManager
DefaultGroupName=Project Manager
OutputDir=installer
OutputBaseFilename=ProjectManager-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "dist\ProjectManager\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autodesktop}\Project Manager"; Filename: "{app}\ProjectManager.exe"
Name: "{group}\Project Manager"; Filename: "{app}\ProjectManager.exe"

[Run]
Filename: "{app}\ProjectManager.exe"; Description: "Launch Project Manager"; Flags: nowait postinstall skipifsilent