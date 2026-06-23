#!/usr/bin/env python3
"""
FurrBox neutral CLI simulator.

This script accepts common Windows and Linux terminal commands, normalizes them,
and presents a platform-neutral terminal experience without exposing Python
tracebacks or host-specific command behavior.
"""

from __future__ import annotations

import getpass
import os
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from colorama import Fore, Style, init

    init(autoreset=True)
except ImportError:
    class _Fallback:
        BLACK = RED = GREEN = YELLOW = BLUE = MAGENTA = CYAN = WHITE = RESET_ALL = BRIGHT = DIM = NORMAL = ""

    Fore = Style = _Fallback()


@dataclass
class TerminalState:
    cwd: Path
    username: str
    hostname: str = "furrbox"
    prompt_template: str = "{user}@{host}:{path}$ "

    def prompt(self) -> str:
        home = Path.home()
        try:
            display_path = "~" if self.cwd == home else str(self.cwd).replace(str(home), "~", 1)
        except ValueError:
            display_path = str(self.cwd)
        display_path = display_path.replace("\\", "/")
        return self.prompt_template.format(user=self.username, host=self.hostname, path=display_path)


class NeutralTerminal:
    def __init__(self) -> None:
        self.state = TerminalState(cwd=Path.cwd().resolve(), username=getpass.getuser())
        self.running = True

    def run(self) -> None:
        self.print_banner()
        while self.running:
            try:
                raw = input(Fore.GREEN + self.state.prompt() + Style.RESET_ALL)
            except (KeyboardInterrupt, EOFError):
                print()
                self.exit_terminal()
                break

            if not raw.strip():
                continue

            self.dispatch(raw.strip())

    def print_banner(self) -> None:
        print(Fore.CYAN + "FurrBox Neutral Terminal" + Style.RESET_ALL)
        print(Style.DIM + "Type 'exit' or 'quit' to close the session.\n" + Style.RESET_ALL)

    def dispatch(self, raw: str) -> None:
        lower = raw.lower().strip()

        if lower in {"exit", "quit"}:
            self.exit_terminal()
            return

        if lower in {"clear", "cls"}:
            self.clear_screen()
            return

        if lower in {"pwd", "echo %cd%"}:
            print(self.format_path(self.state.cwd))
            return

        try:
            parts = shlex.split(raw, posix=False)
        except ValueError as exc:
            self.error(f"Syntaxfehler: {exc}")
            return

        if not parts:
            return

        command = parts[0].lower()
        args = parts[1:]

        handlers = {
            "ls": self.list_directory,
            "dir": self.list_directory,
            "cd": self.change_directory,
            "cat": self.print_file,
            "type": self.print_file,
            "whoami": self.whoami,
            "help": self.help,
        }

        handler = handlers.get(command)
        if handler is None:
            self.error(f"{command}: command not found")
            return

        try:
            handler(args)
        except PermissionError:
            self.error("Zugriff verweigert")
        except FileNotFoundError:
            self.error("Datei oder Verzeichnis nicht gefunden")
        except OSError as exc:
            self.error(str(exc))
        except Exception as exc:
            self.error(f"Fehler: {exc}")

    def list_directory(self, args: list[str]) -> None:
        target = self.resolve_path(args[0]) if args else self.state.cwd
        if not target.exists():
            raise FileNotFoundError()
        if not target.is_dir():
            print(self.format_file(target))
            return

        entries = sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        if not entries:
            print(Style.DIM + "(empty)" + Style.RESET_ALL)
            return

        for entry in entries:
            if entry.is_dir():
                print(Fore.BLUE + entry.name + "/" + Style.RESET_ALL)
            elif os.access(entry, os.X_OK):
                print(Fore.GREEN + entry.name + Style.RESET_ALL)
            else:
                print(self.format_file(entry))

    def change_directory(self, args: list[str]) -> None:
        if not args:
            self.state.cwd = Path.home().resolve()
            return

        target = self.resolve_path(args[0])
        if not target.exists():
            raise FileNotFoundError()
        if not target.is_dir():
            self.error("Kein Verzeichnis")
            return

        self.state.cwd = target.resolve()

    def print_file(self, args: list[str]) -> None:
        if not args:
            self.error("Dateiname fehlt")
            return

        target = self.resolve_path(args[0])
        if not target.exists() or not target.is_file():
            raise FileNotFoundError()

        try:
            content = target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = target.read_text(encoding="latin-1", errors="replace")

        print(content, end="" if content.endswith("\n") else "\n")

    def whoami(self, _args: list[str]) -> None:
        print(self.state.username)

    def help(self, _args: list[str]) -> None:
        print(Fore.CYAN + "Available neutral commands:" + Style.RESET_ALL)
        print("  ls / dir              list directory")
        print("  cd [path]             change directory")
        print("  pwd / echo %cd%       show current directory")
        print("  cat / type [file]     print file contents")
        print("  clear / cls           clear screen")
        print("  whoami                show current user")
        print("  exit / quit           close terminal")

    def clear_screen(self) -> None:
        print("\033[2J\033[H", end="")

    def exit_terminal(self) -> None:
        print(Fore.CYAN + "Session closed." + Style.RESET_ALL)
        self.running = False

    def resolve_path(self, raw: str) -> Path:
        cleaned = raw.strip().strip('"').strip("'")
        if cleaned in {"~", "%userprofile%"}:
            return Path.home()

        cleaned = cleaned.replace("%USERPROFILE%", str(Path.home())).replace("%userprofile%", str(Path.home()))
        path = Path(cleaned)
        if not path.is_absolute():
            path = self.state.cwd / path
        return path.resolve()

    def format_path(self, path: Path) -> str:
        return str(path).replace("\\", "/")

    def format_file(self, path: Path) -> str:
        size = path.stat().st_size if path.exists() else 0
        return f"{path.name}  {Style.DIM}{self.human_size(size)}{Style.RESET_ALL}"

    def human_size(self, size: int) -> str:
        units = ["B", "KB", "MB", "GB", "TB"]
        value = float(size)
        for unit in units:
            if value < 1024 or unit == units[-1]:
                return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} {unit}"
            value /= 1024
        return f"{size} B"

    def error(self, message: str) -> None:
        print(Fore.RED + f"error: {message}" + Style.RESET_ALL, file=sys.stderr)


if __name__ == "__main__":
    NeutralTerminal().run()
