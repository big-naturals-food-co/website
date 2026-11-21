import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('updater', Path(__file__).with_name('update-goose-nibbles.py'))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class ManifestTests(unittest.TestCase):
    def test_refresh_requests_v2_even_when_server_current_is_v1(self):
        calls = []

        def fetch(server, action, **kwargs):
            calls.append((action, kwargs))
            if action in ('ingredients', 'offers', 'products'):
                return 49, []
            self.assertEqual(action, 'recipe')
            return 49, {'name': kwargs['recipe']['id'], 'inputs': []}

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'manifest.json'
            with patch.object(updater, 'fetch', side_effect=fetch), patch('sys.argv', ['update', '--output', str(output)]):
                self.assertEqual(updater.main(), 0)
            self.assertEqual(len(json.loads(output.read_text())['flavors']), 3)
        self.assertEqual(calls[3:], [
            ('recipe', {'recipe': {'id': 'cranberry-caboodle', 'version': 1}}),
            ('recipe', {'recipe': {'id': 'violets-demise', 'version': 2}}),
            ('recipe', {'recipe': {'id': 'apple', 'version': 2}}),
        ])

    def test_cocoa_butter_estimate_orders_active_replacement_and_excludes_oil(self):
        recipe = {'name': 'Test', 'inputs': [
            {'id': 'oil', 'material_id': 'avocado-oil', 'removed': True},
            {'id': 'cocoa', 'material_id': 'cocoa-butter', 'preparation': 'melted',
             'quantity': {'numerator': 1, 'denominator': 1, 'unit': 'us_tablespoon'}},
            {'id': 'larger', 'material_id': 'larger',
             'quantity': {'numerator': 15, 'denominator': 1, 'unit': 'gram'}},
            {'id': 'smaller', 'material_id': 'smaller',
             'quantity': {'numerator': 13, 'denominator': 1, 'unit': 'gram'}},
        ]}
        estimates = json.loads(Path(__file__).with_name('goose-nibbles-estimates.json').read_text())
        materials = {key: {'name': name} for key, name in [
            ('cocoa-butter', 'Cocoa butter'), ('larger', 'Larger'), ('smaller', 'Smaller')]}
        result, estimated = updater.build_flavor(recipe, materials, {}, {}, estimates)
        self.assertEqual(result['ingredients'], ['Larger', 'Cocoa butter', 'Smaller'])
        self.assertEqual(estimated, ['cocoa'])

    def test_combines_sections_and_ignores_removed_inputs(self):
        recipe = {'key': {'id': 'test', 'version': 2}, 'name': 'Test', 'status': 'draft', 'inputs': [
            {'id': 'dry', 'material_id': 'apple', 'quantity': {'numerator': 2, 'denominator': 1, 'unit': 'gram'}},
            {'id': 'garnish', 'material_id': 'apple', 'quantity': {'numerator': 3, 'denominator': 1, 'unit': 'gram'}},
            {'id': 'removed', 'material_id': 'apple', 'removed': True},
        ]}
        recipe['inputs'].append({'id': 'other', 'material_id': 'pear', 'quantity': {'numerator': 4, 'denominator': 1, 'unit': 'gram'}})
        result, _ = updater.build_flavor(recipe, {'apple': {'name': 'Apple'}, 'pear': {'name': 'Pear'}}, {}, {})
        self.assertEqual(result, {'name': 'Test', 'ingredients': ['Apple', 'Pear']})

    def test_conversion_requires_matching_preparation_and_is_not_guessed(self):
        quantity = {'numerator': 1, 'denominator': 2, 'unit': 'us_cup'}
        product = {'conversions': [{'preparation': None, 'grams': '40',
                                    'quantity': {'numerator': 1, 'denominator': 4, 'unit': 'us_cup'}}]}
        self.assertEqual(updater.grams(quantity, None, product), 80)
        self.assertIsNone(updater.grams(quantity, 'chopped', product))

    def test_missing_weight_does_not_create_weight_order(self):
        recipe = {'key': {'id': 'test', 'version': 1}, 'name': 'Test', 'status': 'draft', 'inputs': [
            {'id': 'a', 'material_id': 'a', 'quantity': None},
            {'id': 'b', 'material_id': 'b', 'quantity': {'numerator': 10, 'denominator': 1, 'unit': 'gram'}},
        ]}
        with self.assertRaisesRegex(ValueError, 'no weight or estimate'):
            updater.build_flavor(recipe, {'a': {'name': 'A'}, 'b': {'name': 'B'}}, {}, {})

    def test_estimates_are_marked_and_source_data_takes_precedence(self):
        recipe = {'key': {'id': 'test', 'version': 1}, 'name': 'Test', 'status': 'draft', 'inputs': [
            {'id': 'a', 'material_id': 'a', 'source': {'offer_id': 'offer'},
             'quantity': {'numerator': 1, 'denominator': 1, 'unit': 'us_teaspoon'}},
        ]}
        materials = {'a': {'name': 'A'}}
        offers = {'offer': {'product_id': 'p'}}
        estimates = {'weight_per_teaspoon_grams': {'a': {'grams': 5, 'basis': 'guess'}}}
        products = {'p': {'id': 'p', 'ingredient_statement': None, 'conversions': []}}
        result, estimated = updater.build_flavor(recipe, materials, offers, products, estimates)
        self.assertEqual(result['ingredients'], ['A'])
        self.assertEqual(estimated, ['a'])
        products['p']['ingredient_statement'] = 'Verified'
        products['p']['conversions'] = [{'preparation': None, 'grams': '3',
                                         'quantity': {'numerator': 1, 'denominator': 1, 'unit': 'us_teaspoon'}}]
        result, estimated = updater.build_flavor(recipe, materials, offers, products, estimates)
        self.assertEqual(result['ingredients'], ['A'])
        self.assertEqual(estimated, [])


if __name__ == '__main__':
    unittest.main()
