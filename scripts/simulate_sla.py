"""
Interactive SLA Test Helper
Usage from C:\\PACE\\LCS:
  docker cp scripts/simulate_sla.py crm-frappe-1:/tmp/simulate_sla.py
  docker exec -w /home/frappe/frappe-bench/sites crm-frappe-1 /home/frappe/frappe-bench/env/bin/python /tmp/simulate_sla.py [command]

Commands:
  reminder [user]  - Sets an SLA task due in 45 mins & triggers the 1-hour pre-deadline reminder notification
  warning [user]   - Sets an SLA task due 10 mins ago & triggers the overdue SLA breach warning notification
  check            - Runs the scheduler monitor check for all active SLA tasks
  list             - Lists all active SLA leads and tasks with their countdowns
"""

import sys
import frappe
from frappe.utils import add_to_date, now_datetime
from crm.automation.lead_sla import check_sla_deadlines_and_reminders

def get_target_user(default="Administrator"):
    if len(sys.argv) > 2:
        return sys.argv[2]
    # Check if logged in user or sarah exists
    for candidate in ["Administrator", "sarah.demo@example.com"]:
        if frappe.db.exists("User", candidate):
            return candidate
    return default

def ensure_test_lead(user):
    # Find existing test lead or create one
    lead_name = frappe.db.get_value("CRM Lead", {"email": "slatest@example.com"}, "name")
    if not lead_name:
        lead = frappe.get_doc({
            "doctype": "CRM Lead",
            "first_name": "SLA Demo",
            "last_name": "Hot Lead",
            "email": "slatest@example.com",
            "mobile_no": "+919876543210",
            "status": "New",
            "custom_lead_tier": "A1",
            "custom_sla_hours": 4,
            "custom_playbook": "Hot MQL · call within 4 hrs; 6-touch cadence",
            "lead_owner": user
        })
        lead.insert(ignore_permissions=True)
        frappe.db.commit()
        lead_name = lead.name
        print(f"Created demo lead: {lead_name} assigned to {user}")
    else:
        # Ensure lead is assigned to user
        frappe.db.set_value("CRM Lead", lead_name, {"lead_owner": user, "custom_sla_hours": 4, "status": "New"})
        frappe.db.commit()

    # Get the SLA task
    task_name = frappe.db.get_value("CRM Task", {"reference_docname": lead_name, "custom_is_sla_task": 1}, "name")
    if not task_name:
        # Trigger lead update to create task
        lead = frappe.get_doc("CRM Lead", lead_name)
        lead.save()
        frappe.db.commit()
        task_name = frappe.db.get_value("CRM Task", {"reference_docname": lead_name, "custom_is_sla_task": 1}, "name")

    return lead_name, task_name

def simulate_reminder():
    user = get_target_user()
    lead_name, task_name = ensure_test_lead(user)
    
    # Set due date to 45 minutes in the future (within the 1-hour window)
    new_due = add_to_date(now_datetime(), minutes=45)
    frappe.db.set_value("CRM Task", task_name, {
        "due_date": new_due,
        "status": "Todo",
        "custom_reminder_sent": 0,
        "assigned_to": user
    })
    frappe.db.set_value("CRM Lead", lead_name, {
        "response_by": new_due,
        "sla_status": "First Response Due"
    })
    frappe.db.commit()
    print(f"Set Task #{task_name} for Lead {lead_name} due in 45 minutes ({new_due.strftime('%H:%M:%S')}).")
    
    # Trigger the check
    check_sla_deadlines_and_reminders()
    frappe.db.commit()
    print(f"✓ Triggered 1-Hour Reminder notification to {user}! Check the CRM notification bell.")

def simulate_warning():
    user = get_target_user()
    lead_name, task_name = ensure_test_lead(user)
    
    # Set due date to 10 minutes in the PAST (deadline breached)
    new_due = add_to_date(now_datetime(), minutes=-10)
    frappe.db.set_value("CRM Task", task_name, {
        "due_date": new_due,
        "status": "Todo",
        "custom_warning_sent": 0,
        "assigned_to": user
    })
    frappe.db.set_value("CRM Lead", lead_name, {
        "response_by": new_due,
        "sla_status": "First Response Due"
    })
    frappe.db.commit()
    print(f"Set Task #{task_name} for Lead {lead_name} due 10 minutes AGO ({new_due.strftime('%H:%M:%S')}).")
    
    # Trigger the check
    check_sla_deadlines_and_reminders()
    frappe.db.commit()
    print(f"✓ Triggered SLA Breach Warning notification to {user} & Admin! Check the CRM notification bell.")

def list_sla_tasks():
    tasks = frappe.get_all(
        "CRM Task",
        filters={"custom_is_sla_task": 1},
        fields=["name", "title", "assigned_to", "status", "due_date", "custom_reminder_sent", "custom_warning_sent", "reference_docname"]
    )
    print(f"\nFound {len(tasks)} SLA Tasks:")
    for t in tasks:
        lead_status = frappe.db.get_value("CRM Lead", t.reference_docname, "sla_status")
        print(f"  - Task #{t.name}: {t.title}")
        print(f"    Assigned: {t.assigned_to} | Due: {t.due_date} | Status: {t.status}")
        print(f"    Reminder Sent: {bool(t.custom_reminder_sent)} | Warning Sent: {bool(t.custom_warning_sent)} | Lead SLA Status: {lead_status}\n")

if __name__ == "__main__":
    frappe.init(site="crm.localhost")
    frappe.connect()
    
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "reminder":
        simulate_reminder()
    elif cmd == "warning":
        simulate_warning()
    elif cmd == "check":
        check_sla_deadlines_and_reminders()
        frappe.db.commit()
        print("✓ Executed SLA check.")
    elif cmd == "list":
        list_sla_tasks()
    else:
        print(f"Unknown command: {cmd}. Available: reminder, warning, check, list")
