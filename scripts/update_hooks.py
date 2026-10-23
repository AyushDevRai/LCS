import re

def update_hooks_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update doc_events for CRM Lead and CRM Call Log
    pattern_lead = re.compile(r'"CRM Lead":\s*\{\s*"on_update":\s*\["crm\.automation\.events\.on_lead_update"\]\s*,?\s*\},?')
    replacement_lead = (
        '"CRM Lead": {\n'
        '\t\t"on_update": [\n'
        '\t\t\t"crm.automation.events.on_lead_update",\n'
        '\t\t\t"crm.automation.lead_sla.on_lead_update",\n'
        '\t\t],\n'
        '\t},\n'
        '\t"CRM Call Log": {\n'
        '\t\t"after_insert": [\n'
        '\t\t\t"crm.automation.lead_sla.on_call_log_insert",\n'
        '\t\t],\n'
        '\t},'
    )

    # 2. Update scheduler cron for 5 minutes
    pattern_cron = re.compile(r'"\*/5 \* \* \* \*":\s*\[\s*"crm\.lead_syncing\.background_sync\.sync_leads_from_sources_5_minutes"\s*\]\s*,?')
    replacement_cron = (
        '"*/5 * * * *": [\n'
        '\t\t\t"crm.lead_syncing.background_sync.sync_leads_from_sources_5_minutes",\n'
        '\t\t\t"crm.automation.lead_sla.check_sla_deadlines_and_reminders",\n'
        '\t\t],'
    )

    if "crm.automation.lead_sla.on_lead_update" not in content:
        content, count1 = pattern_lead.subn(replacement_lead, content, count=1)
        if count1 == 0:
            print(f"Warning: pattern_lead did not match in {filepath}")
        else:
            print(f"Updated doc_events in {filepath}")

    if "crm.automation.lead_sla.check_sla_deadlines_and_reminders" not in content:
        content, count2 = pattern_cron.subn(replacement_cron, content, count=1)
        if count2 == 0:
            print(f"Warning: pattern_cron did not match in {filepath}")
        else:
            print(f"Updated scheduler_events in {filepath}")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Saved {filepath}")

if __name__ == '__main__':
    import sys
    for path in sys.argv[1:]:
        update_hooks_file(path)
