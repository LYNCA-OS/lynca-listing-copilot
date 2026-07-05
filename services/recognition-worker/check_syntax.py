from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent


def iter_python_files() -> list[Path]:
    paths: list[Path] = []
    for directory in [ROOT / "app", ROOT / "tests"]:
        paths.extend(sorted(directory.rglob("*.py")))
    return paths


def main() -> None:
    for path in iter_python_files():
        source = path.read_text(encoding="utf-8")
        compile(source, str(path), "exec")
    print("recognition worker python syntax ok")


if __name__ == "__main__":
    main()
