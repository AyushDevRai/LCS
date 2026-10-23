import frappe
from frappe.utils import add_to_date, now_datetime
from crm.automation.lead_sla import check_sla_deadlines_and_reminders

def run_tests():
    frappe.init(site='crm.localhost')
    frappe.connect()

    print("\n==========================================")
    print("RUNNING END-TO-END LEAD SLA WORKFLOW TEST")
    print("==========================================\n")

    test_user = "sarah.demo@example.com"
    if not frappe.db.exists("User", test_user):
        test_user = "Administrator"

    # Step 1: Create a test Hot MQL Lead (A1, 4 hour SLA)
    test_lead = frappe.get_doc({
        "doctype": "CRM Lead",
        "first_name": "SLA Test",
        "last_name": "Hot Lead",
        "email": "slatest@example.com",
        "mobile_no": "+919876543210",
        "status": "New",
        "custom_lead_tier": "A1",
        "custom_sla_hours": 4,
        "custom_playbook": "Hot MQL · call within 4 hrs; 6-touch cadence",
        "lead_owner": test_user,
    })
    test_lead.insert(ignore_permissions=True)
    frappe.db.commit()
    lead_name = test_lead.name
    print(f"1. Created Lead: {lead_name} (A1, 4h SLA, owner: {test_user})")

    # Verify Lead SLA fields
    lead = frappe.get_doc("CRM Lead", lead_name)
    assert lead.response_by is not None, "Error: response_by was not set on Lead!"
    assert lead.sla_status == "First Response Due", f"Error: sla_status is {lead.sla_status}, expected 'First Response Due'"
    assert lead.custom_sla_due_date is not None, "Error: custom_sla_due_date was not set on Lead!"
    print(f"   ✓ Lead SLA fields verified: response_by = {lead.response_by}, status = {lead.sla_status}")

    # Verify Task Creation
    tasks = frappe.get_all(
        "CRM Task",
        filters={"reference_doctype": "CRM Lead", "reference_docname": lead_name, "custom_is_sla_task": 1},
        fields=["name", "title", "assigned_to", "priority", "status", "due_date", "custom_sla_hours"]
    )
    assert len(tasks) == 1, f"Error: Expected 1 SLA Task, found {len(tasks)}"
    task = tasks[0]
    assert task.assigned_to == test_user, f"Error: Task assigned to {task.assigned_to}, expected {test_user}"
    assert task.priority == "High", f"Error: Task priority is {task.priority}, expected 'High'"
    assert task.custom_sla_hours == 4, f"Error: Task SLA hours is {task.custom_sla_hours}, expected 4"
    assert task.status == "Todo", f"Error: Task status is {task.status}, expected 'Todo'"
    task_name = task.name
    print(f"   ✓ SLA Task created: #{task_name} '{task.title}' assigned to {task.assigned_to} (Priority: {task.priority})")

    # Verify Assignment Notification
    notifs = frappe.get_all("CRM Notification", filters={"to_user": test_user, "reference_name": task_name})
    assert len(notifs) >= 1, f"Error: Assignment notification not found for task {task_name}"
    print(f"   ✓ Assignment notification sent to {test_user}")

    # Step 2: Test 1-Hour Pre-Deadline Reminder Notification
    print("\n2. Testing 1-Hour Pre-Deadline Reminder Notification...")
    # Simulate deadline in 45 minutes
    fake_reminder_due = add_to_date(now_datetime(), minutes=45)
    frappe.db.set_value("CRM Task", task_name, {"due_date": fake_reminder_due, "custom_reminder_sent": 0}, update_modified=False)
    
    # Run the scheduled SLA monitor
    check_sla_deadlines_and_reminders()
    frappe.db.commit()

    task_after_reminder = frappe.get_doc("CRM Task", task_name)
    assert task_after_reminder.custom_reminder_sent == 1, "Error: custom_reminder_sent should be 1"
    
    reminder_notifs = frappe.get_all(
        "CRM Notification",
        filters={"to_user": test_user, "reference_name": task_name, "message": ["like", "%REMINDER%"]}
    )
    assert len(reminder_notifs) >= 1, "Error: Reminder notification not generated"
    print(f"   ✓ Reminder notification dispatched: '{reminder_notifs[0]['name']}' ({reminder_notifs[0].get('message') or 'REMINDER'})")

    # Step 3: Test Post-Deadline Warning Notification
    print("\n3. Testing Post-Deadline Warning Notification...")
    # Simulate deadline passed 10 minutes ago
    fake_breach_due = add_to_date(now_datetime(), minutes=-10)
    frappe.db.set_value("CRM Task", task_name, {"due_date": fake_breach_due, "custom_warning_sent": 0}, update_modified=False)

    # Run the scheduled SLA monitor
    check_sla_deadlines_and_reminders()
    frappe.db.commit()

    task_after_warning = frappe.get_doc("CRM Task", task_name)
    assert task_after_warning.custom_warning_sent == 1, "Error: custom_warning_sent should be 1"

    warning_notifs = frappe.get_all(
        "CRM Notification",
        filters={"to_user": test_user, "reference_name": task_name, "message": ["like", "%WARNING: SLA BREACHED%"]}
    )
    assert len(warning_notifs) >= 1, "Error: Warning notification not generated"
    print(f"   ✓ Warning notification dispatched: '{warning_notifs[0]['name']}'")

    lead_after_warning = frappe.get_doc("CRM Lead", lead_name)
    assert lead_after_warning.sla_status == "Failed", f"Error: Lead SLA status is {lead_after_warning.sla_status}, expected 'Failed'"
    print(f"   ✓ Lead SLA status updated to '{lead_after_warning.sla_status}'")

    # Step 4: Test Auto-Resolution when Call is Logged / Contacted
    print("\n4. Testing Auto-Resolution on Call Log...")
    call_log = frappe.get_doc({
        "doctype": "CRM Call Log",
        "reference_doctype": "CRM Lead",
        "reference_docname": lead_name,
        "type": "Outgoing",
        "status": "Completed",
        "start_time": now_datetime(),
        "from": "+911122334455",
        "to": "+919876543210"
    })
    call_log.insert(ignore_permissions=True)
    frappe.db.commit()

    task_final = frappe.get_doc("CRM Task", task_name)
    assert task_final.status == "Done", f"Error: Expected task status 'Done', got {task_final.status}"
    print(f"   ✓ SLA Task auto-completed to status '{task_final.status}'")

    lead_final = frappe.get_doc("CRM Lead", lead_name)
    assert lead_final.sla_status == "Fulfilled", f"Error: Expected lead sla_status 'Fulfilled', got {lead_final.sla_status}"
    assert lead_final.first_responded_on is not None, "Error: first_responded_on was not set"
    print(f"   ✓ Lead SLA status auto-fulfilled to '{lead_final.sla_status}' with response timestamp {lead_final.first_responded_on}")

    # Cleanup test documents
    print("\n5. Cleaning up test documents...")
    frappe.delete_doc("CRM Call Log", call_log.name, force=True)
    frappe.delete_doc("CRM Task", task_name, force=True)
    for n in frappe.get_all("CRM Notification", filters={"reference_name": task_name}):
        frappe.delete_doc("CRM Notification", n.name, force=True)
    frappe.delete_doc("CRM Lead", lead_name, force=True)
    frappe.db.commit()
    print("   ✓ Cleaned up test lead, task, call log, and notifications.")

    print("\n==========================================")
    print("ALL LEAD SLA TESTS PASSED SUCCESSFULLY! ✓")
    print("==========================================\n")

if __name__ == '__main__':
    run_tests()
