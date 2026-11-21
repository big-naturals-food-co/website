#!/usr/bin/env python3
"""Refresh Goose Nibbles ingredient lists from business-os."""

import argparse
import json
import sys
from fractions import Fraction
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / 'web' / 'data' / 'goose-nibbles.json'
RECIPE_VERSIONS = (('cranberry-caboodle', 1), ('violets-demise', 2), ('apple', 2))
MASS_UNITS = {'gram': Fraction(1), 'kilogram': Fraction(1000),
              'ounce': Fraction(45359237, 1600000), 'pound': Fraction(45359237, 100000)}
VOLUME_UNITS = {'us_cup': Fraction(48), 'us_tablespoon': Fraction(3), 'us_teaspoon': Fraction(1)}


def amount(quantity):
    return Fraction(quantity['numerator'], quantity['denominator'])


def grams(quantity, preparation, product):
    if not quantity:
        return None
    unit = quantity['unit']
    if unit in MASS_UNITS:
        return amount(quantity) * MASS_UNITS[unit]
    candidates = set()
    for conversion in (product or {}).get('conversions', []):
        if conversion.get('preparation') != preparation:
            continue
        basis = conversion['quantity']
        if unit == basis['unit']:
            ratio = amount(quantity) / amount(basis)
        elif unit in VOLUME_UNITS and basis['unit'] in VOLUME_UNITS:
            ratio = amount(quantity) * VOLUME_UNITS[unit] / (amount(basis) * VOLUME_UNITS[basis['unit']])
        else:
            continue
        candidates.add(ratio * Fraction(str(conversion['grams'])))
    return next(iter(candidates)) if len(candidates) == 1 else None


def build_flavor(recipe, materials, offers, products, estimates=None):
    estimates = estimates or {}
    groups = {}
    estimates_used = []
    for item in recipe['inputs']:
        if item.get('removed'):
            continue
        material = materials[item['material_id']]
        source = item.get('source') or {}
        offer = offers.get(source.get('offer_id'))
        product = products.get(offer['product_id']) if offer else None
        key = item['material_id']
        entry = groups.setdefault(key, {
            'name': estimates.get('ingredient_names', {}).get(key, material['name']),
            'weight': Fraction(0),
        })
        weight = grams(item.get('quantity'), item.get('preparation'), product)
        estimate = estimates.get('weight_per_teaspoon_grams', {}).get(item['material_id'])
        quantity = item.get('quantity')
        if weight is None and estimate and quantity and quantity['unit'] in VOLUME_UNITS:
            weight = amount(quantity) * VOLUME_UNITS[quantity['unit']] * Fraction(str(estimate['grams']))
            estimates_used.append(item['id'])
        if weight is None:
            raise ValueError(f"{recipe['name']}: no weight or estimate for {item['id']}")
        entry['weight'] += weight
    entries = sorted(groups.values(), key=lambda e: (-e['weight'], e['name'].casefold()))
    return {'name': recipe['name'], 'ingredients': [entry['name'] for entry in entries]}, estimates_used


def fetch(server, action, **kwargs):
    payload = json.dumps({'api_version': 1, 'operation': {'action': action, **kwargs}}).encode()
    request = Request(server.rstrip('/') + '/api/v1/request', data=payload,
                      headers={'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=15) as response:
        result = json.load(response)
    if not result.get('ok'):
        raise ValueError(f"business-os {action}: {result.get('error')}")
    return result['revision'], result['data']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', default='http://127.0.0.1:7310')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--estimates', type=Path, default=ROOT / 'scripts' / 'goose-nibbles-estimates.json')
    args = parser.parse_args()
    try:
        responses = [fetch(args.server, action) for action in ('ingredients', 'offers', 'products')]
        responses += [fetch(args.server, 'recipe', recipe={'id': rid, 'version': version})
                      for rid, version in RECIPE_VERSIONS]
        revisions = {revision for revision, _ in responses}
        if len(revisions) != 1:
            raise ValueError('business-os changed while reading; rerun to obtain one consistent revision')
        materials, offers, products = ({row['id']: row for row in data} for _, data in responses[:3])
        estimates = json.loads(args.estimates.read_text(encoding='utf-8'))
        results = [build_flavor(data, materials, offers, products, estimates) for _, data in responses[3:]]
        manifest = {'flavors': [flavor for flavor, _ in results]}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_name(args.output.name + '.tmp')
        temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        temporary.replace(args.output)
        print(f'Updated {args.output} from business-os revision {revisions.pop()}.')
        print('Recipe versions: ' + ', '.join(f'{rid} v{version}' for rid, version in RECIPE_VERSIONS))
        for flavor, estimated in results:
            if estimated:
                print(f"{flavor['name']}: estimated weights for {', '.join(estimated)}")
    except (URLError, OSError, ValueError, KeyError, ZeroDivisionError) as exc:
        print(f'Could not update manifest: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
