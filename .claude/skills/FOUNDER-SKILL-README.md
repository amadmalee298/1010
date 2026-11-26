# Founder skills (third-party)

The `founder-*` folders are the 11 Claude skills from
https://github.com/Jakeschincariol/founder-skill (commit fd9385b, v1.0), by Jake Schincariol,
MIT licensed (see `FOUNDER-SKILL-LICENSE`). Copied unchanged so they load in every Claude Code
session on this project.

Reviewed before adding: Python standard library only, no network calls; the scripts only read
and write files in a `founder/` folder. Their outputs (`founder/`) hold the shop's private
numbers, so that folder is git-ignored.
