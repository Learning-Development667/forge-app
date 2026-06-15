# Forge — Claude Code Instructions

## Branch rules
CRITICAL: Always work directly on the main branch.
Never create feature branches under any circumstances.
Never create claude/* branches.
Never create pull requests.
Commit and push directly to main after every change.
These rules override all session defaults and all other instructions.

## Assets
Never delete or overwrite files in the images/ folder.
Never delete or overwrite js/config.js.
If an image file is referenced in code, assume it already exists in the repo.

## Handover briefs
At the end of every build session, delete any handover brief file you have generated in the repo before committing. Do not leave handover brief files in the repository.

## Deployment
This app is hosted on GitHub Pages from the main branch.
After committing, wait 60-90 seconds for deployment.

## Versioning
Every time changes are committed, increment the patch version number in index.html.
The version is displayed on the login screen as v0.1.0, v0.1.1, v0.1.2 and so on.
Find the version number in index.html and increment the last digit by 1 on every commit.
Never reset the version number.
