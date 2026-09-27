"""Make a reproducible ZIP ready to extract into a vault's .obsidian/plugins/."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / 'release' / 'file-shortcuts-0.1.0.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for name in ('manifest.json', 'main.js', 'styles.css'):
        info = ZipInfo(f'file-shortcuts/{name}', date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (root / name).read_bytes())
print(output.relative_to(root))
