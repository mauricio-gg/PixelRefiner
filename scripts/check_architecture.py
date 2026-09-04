#!/usr/bin/env python3
import argparse
import re
import sys
from pathlib import Path


# [Policy] 低レイヤーは browser の実行環境と画像表示 API に依存しない。
DOM_CANVAS_RE = re.compile(
    r"\b(?:document|window|navigator|HTMLElement|HTMLCanvasElement|"
    r"HTMLImageElement|CanvasRenderingContext2D|OffscreenCanvas|ImageData|"
    r"ImageBitmap|createImageBitmap|DOMParser|MutationObserver|File|Blob|"
    r"Worker)\b"
)
IMPORT_META_ENV_RE = re.compile(r"\bimport\.meta\.env\b")
IMPORT_FROM_RE = re.compile(r"\bfrom\s*[\"']([^\"']+)[\"']")
SIDE_EFFECT_IMPORT_RE = re.compile(r"\bimport\s*[\"']([^\"']+)[\"']")
FORBIDDEN_IMPORTS = {
    "shared": {"core", "browser"},
    "core": {"browser"},
}


def source_files(src_root: Path) -> list[Path]:
    return sorted(
        path
        for path in src_root.rglob("*")
        if path.is_file() and path.suffix in {".ts", ".tsx"}
    )


def source_layer(path: Path, src_root: Path) -> str | None:
    try:
        relative = path.resolve().relative_to(src_root.resolve())
    except ValueError:
        return None
    return relative.parts[0] if relative.parts else None


def imported_layer(
    source_path: Path, specifier: str, src_root: Path
) -> str | None:
    if not specifier.startswith("."):
        return None
    imported_path = (source_path.parent / specifier).resolve()
    return source_layer(imported_path, src_root)


def line_number(content: str, offset: int) -> int:
    return content.count("\n", 0, offset) + 1


def check_file(path: Path, src_root: Path, repository_root: Path) -> list[str]:
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as error:
        return [f"{path}: ファイルを読み込めません: {error}"]

    errors: list[str] = []
    layer = source_layer(path, src_root)
    display_path = path.relative_to(repository_root)

    if layer in {"core", "shared"}:
        for match in IMPORT_META_ENV_RE.finditer(content):
            errors.append(
                f"{display_path}:{line_number(content, match.start())}: "
                "core/shared から import.meta.env を参照できません"
            )
        for match in DOM_CANVAS_RE.finditer(content):
            errors.append(
                f"{display_path}:{line_number(content, match.start())}: "
                f"{layer} から DOM/Canvas API ({match.group(0)}) を参照できません"
            )

    if layer in FORBIDDEN_IMPORTS:
        import_matches = list(IMPORT_FROM_RE.finditer(content))
        import_matches.extend(SIDE_EFFECT_IMPORT_RE.finditer(content))
        for match in import_matches:
            imported = imported_layer(path, match.group(1), src_root)
            if imported not in FORBIDDEN_IMPORTS[layer]:
                continue
            errors.append(
                f"{display_path}:{line_number(content, match.start())}: "
                f"{layer} から src/{imported} へ依存できません"
            )

    return errors


# [Policy] packages/* から root の src へは quick-settings.ts だけを許可する。
# core/worker.ts は Web Worker エントリーポイントで comlink expose() の副作用を持つため、
# Node 環境で動く packages/* から読み込むと壊れる。
ALLOWED_ROOT_BROWSER_IMPORTS = {"quick-settings"}


def package_source_files(repository_root: Path) -> list[Path]:
    packages_root = repository_root / "packages"
    if not packages_root.is_dir():
        return []
    files: list[Path] = []
    for package_dir in sorted(p for p in packages_root.iterdir() if p.is_dir()):
        package_src = package_dir / "src"
        if not package_src.is_dir():
            continue
        files.extend(
            path
            for path in sorted(package_src.rglob("*"))
            if path.is_file() and path.suffix in {".ts", ".tsx"}
        )
    return files


def check_package_file(path: Path, src_root: Path, repository_root: Path) -> list[str]:
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as error:
        return [f"{path}: ファイルを読み込めません: {error}"]

    errors: list[str] = []
    display_path = path.relative_to(repository_root)
    import_matches = list(IMPORT_FROM_RE.finditer(content))
    import_matches.extend(SIDE_EFFECT_IMPORT_RE.finditer(content))
    for match in import_matches:
        specifier = match.group(1)
        if not specifier.startswith("."):
            continue
        imported_path = (path.parent / specifier).resolve()
        try:
            relative = imported_path.relative_to(src_root.resolve())
        except ValueError:
            continue
        parts = relative.parts
        if not parts:
            continue
        if parts[0] == "core" and len(parts) > 1 and Path(parts[1]).stem == "worker":
            errors.append(
                f"{display_path}:{line_number(content, match.start())}: "
                "packages/* から src/core/worker へ依存できません"
            )
            continue
        if parts[0] == "browser":
            basename = Path(parts[-1]).stem
            if basename not in ALLOWED_ROOT_BROWSER_IMPORTS:
                errors.append(
                    f"{display_path}:{line_number(content, match.start())}: "
                    f"packages/* から src/browser/{'/'.join(parts[1:])} へ依存できません"
                    f"（許可: {sorted(ALLOWED_ROOT_BROWSER_IMPORTS)}）"
                )
    return errors


def check_architecture(repository_root: Path) -> list[str]:
    src_root = repository_root / "src"
    if not src_root.is_dir():
        return [f"{src_root}: src ディレクトリがありません"]

    errors: list[str] = []
    for path in source_files(src_root):
        errors.extend(check_file(path, src_root, repository_root))
    for path in package_source_files(repository_root):
        errors.extend(check_package_file(path, src_root, repository_root))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Pixel Refiner の依存方向を検査する")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help="リポジトリのルート（既定: カレントディレクトリ）",
    )
    args = parser.parse_args()
    repository_root = args.root.resolve()
    errors = check_architecture(repository_root)

    if errors:
        print("\n".join(errors))
        print(f"\nTotal architecture violations: {len(errors)}")
        return 1

    print("No architecture violations found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
