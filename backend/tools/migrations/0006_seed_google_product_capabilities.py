from django.db import migrations

SEED_DATA = [
    ('Gmail', 'gmail', 'v1', 'gmail.send', 'users.messages', 'Send email messages on behalf of the user'),
    ('Calendar', 'calendar', 'v3', 'calendar', 'events', 'Full access to calendars and events'),
    ('Calendar', 'calendar', 'v3', 'calendar.events', 'events', 'Create, read, update, and delete calendar events'),
    ('Docs', 'documents', 'v1', 'documents', 'documents', 'Create and edit Google Documents'),
    ('Docs', 'documents', 'v1', 'documents.readonly', 'documents', 'View Google Documents content only'),
    ('Drive', 'drive', 'v3', 'drive', 'files', 'Full access to all Google Drive files'),
    ('Drive', 'drive', 'v3', 'drive.file', 'files', 'Access only to files opened or created by this app'),
    ('Forms', 'forms', 'v1', 'forms.body', 'forms', 'View and change Google Forms structures'),
    ('Forms', 'forms', 'v1', 'forms.responses.readonly', 'forms.responses', 'View responses submitted to Google Forms'),
    ('Meet', 'meet', 'v1', 'meetings.space.created', 'spaces', 'Create and manage Google Meet conference spaces'),
    ('Meet', 'meet', 'v1', 'meetings.space.readonly', 'spaces', 'Read details about existing conference spaces'),
    ('Sheets', 'sheets', 'v4', 'spreadsheets', 'spreadsheets', 'Full access to read and write spreadsheet structures'),
    ('Sheets', 'sheets', 'v4', 'spreadsheets', 'spreadsheets.values', 'Read and write cell values within a spreadsheet'),
    ('Sheets', 'sheets', 'v4', 'spreadsheets.readonly', 'spreadsheets.values', 'Read cell values within a spreadsheet only'),
]

def seed_capabilities(apps, schema_editor):
    GoogleProductCapability = apps.get_model('tools', 'GoogleProductCapability')
    for (prod_display, pkg_name, ver, scope, res_path, desc) in SEED_DATA:
        GoogleProductCapability.objects.update_or_create(
            product_display_name=prod_display,
            package_product_name=pkg_name,
            api_version=ver,
            permission_scope_text=scope,
            target_resource_path=res_path,
            defaults={'description': desc}
        )

def remove_capabilities(apps, schema_editor):
    GoogleProductCapability = apps.get_model('tools', 'GoogleProductCapability')
    GoogleProductCapability.objects.all().delete()

class Migration(migrations.Migration):

    dependencies = [
        ('tools', '0005_googleproductcapability_shareduserasset_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_capabilities, remove_capabilities),
    ]
