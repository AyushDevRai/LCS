# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_to_date, cint, get_datetime, now_datetime, time_diff_in_seconds

COMPLETED_LEAD_STATUSES = ("Contacted", "Replied", "Qualified", "Converted", "Lost", "Do Not Contact")
OPEN_TASK_STATUSES = ("Todo", "Backlog", "In Progress")

DEFAULT_TIER_SLA_HOURS = {
	"A1": 4,
	"A2": 24,
	"B1": 24,
	"B2": 48,
	"C1": 24,
}


def recalculate_matrix_tier(fit_score, intent_score):
	"""Standard 3x3 matrix tier from numeric fit & intent."""
	fit_row = "A" if fit_score >= 35 else ("B" if fit_score >= 25 else "C")
	intent_col = "1" if intent_score >= 35 else ("2" if intent_score >= 20 else "3")
	return f"{fit_row}{intent_col}"


def on_lead_update(doc, method=None):
	"""Triggered when a CRM Lead is saved/updated.
	If lead has SLA hours (or tier with default SLA) and is assigned to a sales rep,
	start the SLA timer, set SLA status/badge, and create the call task.
	If lead status moved to a completed/contacted state, close the SLA task.
	"""
	if frappe.flags.in_install or frappe.flags.in_migrate:
		return

	# 1. Enforce permission: Intent Score is editable by Administrator only
	if doc.has_value_changed("custom_intent_score"):
		is_admin = frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles()
		if not is_admin:
			frappe.throw("Only Administrator can edit Intent Score.")

		# Recalculate matrix tier when Administrator edits Intent Score
		current_tier = doc.get("custom_lead_tier")
		if current_tier in ("A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3") or not current_tier:
			fit = cint(doc.get("custom_fit_score") or 0)
			intent = cint(doc.get("custom_intent_score") or 0)
			new_tier = recalculate_matrix_tier(fit, intent)
			if new_tier != current_tier:
				doc.custom_lead_tier = new_tier
				doc.custom_is_mql = 1 if new_tier in ("A1", "A2", "B1", "B2") else 0
				frappe.db.set_value(
					"CRM Lead",
					doc.name,
					{
						"custom_lead_tier": new_tier,
						"custom_is_mql": doc.custom_is_mql,
					},
					update_modified=False,
				)

	# 2. Handle SLA completion if lead was contacted/qualified
	if doc.status in COMPLETED_LEAD_STATUSES and doc.has_value_changed("status"):
		_complete_sla_for_lead(doc.name)
		return

	# 3. Check if lead has an SLA configured or deduce it from tier
	tier = doc.get("custom_lead_tier")
	sla_hours = cint(doc.get("custom_sla_hours") or 0)
	if sla_hours <= 0 and tier in DEFAULT_TIER_SLA_HOURS:
		sla_hours = DEFAULT_TIER_SLA_HOURS[tier]
		frappe.db.set_value("CRM Lead", doc.name, "custom_sla_hours", sla_hours, update_modified=False)
		doc.custom_sla_hours = sla_hours

	lead_owner = doc.get("lead_owner")

	if not lead_owner or sla_hours <= 0:
		return

	if doc.status in COMPLETED_LEAD_STATUSES:
		return

	# Check for existing open SLA tasks for this lead
	existing_tasks = frappe.get_all(
		"CRM Task",
		filters={
			"reference_doctype": "CRM Lead",
			"reference_docname": doc.name,
			"custom_is_sla_task": 1,
			"status": ("in", OPEN_TASK_STATUSES),
		},
		fields=["name", "assigned_to", "due_date"],
	)

	if not existing_tasks:
		# Compute deadline and activate CRM SLA fields
		now = now_datetime()
		deadline = add_to_date(now, hours=sla_hours)

		# Set SLA timer fields on CRM Lead
		update_fields = {
			"response_by": deadline,
			"sla_status": "First Response Due",
			"custom_sla_due_date": deadline,
			"communication_status": doc.get("communication_status") or "Open",
		}
		frappe.db.set_value("CRM Lead", doc.name, update_fields, update_modified=False)
		doc.response_by = deadline
		doc.sla_status = "First Response Due"
		doc.custom_sla_due_date = deadline

		# Create the Call Lead task assigned to the salesman
		lead_label = doc.get("lead_name") or doc.name
		priority = "High" if tier == "A1" else "Medium"
		playbook = doc.get("custom_playbook") or ""

		task = frappe.get_doc({
			"doctype": "CRM Task",
			"title": f"Call Lead: {lead_label} ({tier or 'MQL'} · {sla_hours}h SLA)",
			"assigned_to": lead_owner,
			"due_date": deadline,
			"priority": priority,
			"status": "Todo",
			"reference_doctype": "CRM Lead",
			"reference_docname": doc.name,
			"description": (
				f"<p>LCS classified lead as <strong>{tier or 'MQL'}</strong>.</p>"
				f"<p><strong>Playbook:</strong> {playbook}</p>"
				f"<p><strong>Target SLA:</strong> Call within {sla_hours} hours (Deadline: {deadline}).</p>"
			),
			"custom_is_sla_task": 1,
			"custom_sla_hours": sla_hours,
			"custom_reminder_sent": 0,
			"custom_warning_sent": 0,
		})
		task.insert(ignore_permissions=True)

		# Send assignment notification to the salesperson
		_send_notification(
			to_user=lead_owner,
			message=f"New {tier or 'MQL'} Lead Assigned: {lead_label}. First call due within {sla_hours} hours (by {deadline.strftime('%H:%M %d-%b')}).",
			reference_doctype="CRM Task",
			reference_name=task.name,
		)
	else:
		# If salesman changed on the lead, reassign the task
		for t in existing_tasks:
			if t.assigned_to != lead_owner:
				frappe.db.set_value("CRM Task", t.name, "assigned_to", lead_owner)
				_send_notification(
					to_user=lead_owner,
					message=f"Lead Reassigned: {doc.get('lead_name') or doc.name}. Please follow up on this task.",
					reference_doctype="CRM Task",
					reference_name=t.name,
				)


def on_call_log_insert(doc, method=None):
	"""When a call log is recorded against a CRM Lead, fulfill the SLA and complete the task."""
	if doc.reference_doctype == "CRM Lead" and doc.reference_docname:
		_complete_sla_for_lead(doc.reference_docname)


def _complete_sla_for_lead(lead_name):
	"""Mark open SLA tasks Done and mark lead SLA fulfilled."""
	open_tasks = frappe.get_all(
		"CRM Task",
		filters={
			"reference_doctype": "CRM Lead",
			"reference_docname": lead_name,
			"custom_is_sla_task": 1,
			"status": ("in", OPEN_TASK_STATUSES),
		},
		fields=["name"],
	)
	for t in open_tasks:
		frappe.db.set_value("CRM Task", t.name, "status", "Done")

	now = now_datetime()
	frappe.db.set_value(
		"CRM Lead",
		lead_name,
		{
			"sla_status": "Fulfilled",
			"first_responded_on": now,
		},
		update_modified=False,
	)


def check_sla_deadlines_and_reminders():
	"""Scheduled job: checks all active SLA tasks.
	- 1 hour before deadline: sends reminder notification to salesman.
	- After deadline: sends warning notification to salesman & managers and marks lead SLA failed.
	"""
	tasks = frappe.get_all(
		"CRM Task",
		filters={
			"custom_is_sla_task": 1,
			"status": ("in", OPEN_TASK_STATUSES),
		},
		fields=[
			"name",
			"title",
			"assigned_to",
			"due_date",
			"custom_sla_hours",
			"custom_reminder_sent",
			"custom_warning_sent",
			"reference_doctype",
			"reference_docname",
		],
	)

	now = now_datetime()
	for task in tasks:
		if not task.due_date or not task.assigned_to:
			continue

		due_datetime = get_datetime(task.due_date)
		diff_seconds = time_diff_in_seconds(due_datetime, now)
		lead_name = (
			frappe.db.get_value("CRM Lead", task.reference_docname, "lead_name")
			or task.reference_docname
		)

		# Reminder condition: 0 < diff_seconds <= 3600 (within 1 hour before deadline)
		if 0 < diff_seconds <= 3600 and not task.custom_reminder_sent:
			minutes_left = max(1, int(round(diff_seconds / 60)))
			_send_notification(
				to_user=task.assigned_to,
				message=f"⏰ REMINDER: {minutes_left} minutes left to call lead {lead_name}! Deadline: {due_datetime.strftime('%H:%M %d-%b')}.",
				reference_doctype="CRM Task",
				reference_name=task.name,
			)
			frappe.db.set_value("CRM Task", task.name, "custom_reminder_sent", 1, update_modified=False)

		# Warning condition: diff_seconds <= 0 (deadline has passed and task is still open)
		elif diff_seconds <= 0 and not task.custom_warning_sent:
			_send_notification(
				to_user=task.assigned_to,
				message=f"⚠️ WARNING: SLA BREACHED! Call deadline of {task.custom_sla_hours}h for lead {lead_name} has expired!",
				reference_doctype="CRM Task",
				reference_name=task.name,
			)
			# Escalate to System Managers / Administrator
			admin_users = frappe.get_all("Has Role", filters={"role": "System Manager", "parenttype": "User"}, pluck="parent")
			for admin in set(admin_users):
				if admin != task.assigned_to:
					_send_notification(
						to_user=admin,
						message=f"⚠️ SLA BREACH ESCALATION: Rep {task.assigned_to} failed to call lead {lead_name} within the {task.custom_sla_hours}h SLA window.",
						reference_doctype="CRM Task",
						reference_name=task.name,
					)

			frappe.db.set_value("CRM Task", task.name, "custom_warning_sent", 1, update_modified=False)
			if task.reference_doctype == "CRM Lead" and task.reference_docname:
				frappe.db.set_value("CRM Lead", task.reference_docname, "sla_status", "Failed", update_modified=False)


def _send_notification(to_user, message, reference_doctype="CRM Task", reference_name=None):
	"""Creates a CRM Notification and triggers real-time WebSocket push."""
	if not to_user:
		return
	try:
		notif = frappe.get_doc({
			"doctype": "CRM Notification",
			"to_user": to_user,
			"from_user": "Administrator",
			"type": "Task",
			"message": message,
			"notification_text": message,
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
		})
		notif.insert(ignore_permissions=True)
		frappe.publish_realtime("crm_notification", user=to_user)
	except Exception as e:
		frappe.logger().error(f"Failed to send SLA notification: {e}")
