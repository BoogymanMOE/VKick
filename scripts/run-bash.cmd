@echo off
setlocal
set "BASH=D:\Git\usr\bin\bash.exe"
set "REPO=%~dp0"
"%BASH%" --login -i -c "cd \"%REPO%\" && exec \"$@\"" -- %*
