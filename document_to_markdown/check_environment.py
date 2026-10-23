"""Check imports and supported package versions without invoking pip/network."""
import argparse
import importlib
from importlib.metadata import version
import re


def ready(engine='basic'):
    requirements = [('python-docx', 'docx', (1, 2, 0), (2,)),
                    ('pdfplumber', 'pdfplumber', (0, 11, 4), (0, 12))]
    if engine == 'docling':
        requirements.append(('docling', 'docling.document_converter', (2,), (3,)))
    for distribution, module, minimum, maximum in requirements:
        try:
            installed = tuple(int(n) for n in re.findall(r'\d+', version(distribution))[:3])
            if not minimum <= installed < maximum:
                return False
            importlib.import_module(module)
        except (ImportError, ValueError, RuntimeError):
            return False
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--engine', default='basic', choices=['basic', 'docling'])
    raise SystemExit(0 if ready(parser.parse_args().engine) else 1)
