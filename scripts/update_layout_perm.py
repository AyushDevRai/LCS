import re

def patch_crm_fields_layout(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update handle_perm_level_restrictions
    pattern_perm = re.compile(r'def handle_perm_level_restrictions\(field, doctype, parent_doctype=None\):\n\tif field\.permlevel == 0:')
    replacement_perm = (
        'def handle_perm_level_restrictions(field, doctype, parent_doctype=None):\n'
        '\tif field.get("fieldname") == "custom_intent_score":\n'
        '\t\tis_admin = frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles()\n'
        '\t\tfield["read_only"] = 0 if is_admin else 1\n'
        '\tif field.permlevel == 0:'
    )

    # 2. Update get_field_obj
    pattern_field_obj = re.compile(r'def get_field_obj\(field\):\n\tfield\["placeholder"\]')
    replacement_field_obj = (
        'def get_field_obj(field):\n'
        '\tif field.get("fieldname") == "custom_intent_score":\n'
        '\t\tis_admin = frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles()\n'
        '\t\tfield["read_only"] = 0 if is_admin else 1\n'
        '\tfield["placeholder"]'
    )

    if 'field.get("fieldname") == "custom_intent_score"' not in content:
        content, c1 = pattern_perm.subn(replacement_perm, content, count=1)
        content, c2 = pattern_field_obj.subn(replacement_field_obj, content, count=1)
        print(f"Patched {filepath}: c1={c1}, c2={c2}")
    else:
        print(f"Already patched {filepath}")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    import sys
    for path in sys.argv[1:]:
        patch_crm_fields_layout(path)
