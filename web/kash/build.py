"""Bundle these three dependency-free modules into an offline classic script."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
parts = []
for name in ('model.mjs', 'world.mjs', 'component.mjs'):
    source = (root / name).read_text()
    source = re.sub(r'^import .*?;\n', '', source, flags=re.M)
    source = re.sub(r'^export (?=(?:const|function|class)\b)', '', source, flags=re.M)
    assert not re.search(r'^\s*(import|export)\b', source, re.M)
    parts.append(source)
bundle = '/* Jah.earth KASH map 0.1.0; no external dependencies. */\n(()=>{\n' + '\n'.join(parts) + '\n})();\n'
(root / 'jah-kash-map.bundle.js').write_text(bundle)
print(f'Bundle: {len(bundle.encode())} bytes')
