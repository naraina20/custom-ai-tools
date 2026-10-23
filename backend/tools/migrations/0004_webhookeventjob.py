import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tools', '0003_criticalerrorlog'),
    ]

    operations = [
        migrations.CreateModel(
            name='WebhookEventJob',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('user_id', models.CharField(db_index=True, help_text='Effective deployer user ID', max_length=255)),
                ('idempotency_key', models.CharField(db_index=True, help_text='Unique key from header/payload or SHA-256 payload hash', max_length=255)),
                ('status', models.CharField(choices=[('queued', 'Queued'), ('processing', 'Processing'), ('completed', 'Completed'), ('pending_hitl', 'Awaiting Human Approval'), ('failed', 'Failed')], db_index=True, default='queued', max_length=30)),
                ('deploy_tool_data', models.JSONField(blank=True, default=dict, help_text='Deployment form inputs')),
                ('webhook_data', models.JSONField(blank=True, help_text='Raw inbound webhook payload', null=True)),
                ('deployer_data', models.JSONField(blank=True, default=dict, help_text='Deployer profile details')),
                ('tool_owner_data', models.JSONField(blank=True, default=dict, help_text='Tool owner profile details')),
                ('thread_id', models.CharField(blank=True, default='', help_text='LangGraph thread ID', max_length=255)),
                ('result', models.JSONField(blank=True, default=dict, help_text='Output result summary from graph engine')),
                ('error_message', models.TextField(blank=True, help_text='Execution failure message if any', null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('deployment', models.ForeignKey(blank=True, help_text='User tool deployment if triggered via deployment secret', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='webhook_jobs', to='tools.usertooldeployment')),
                ('tool', models.ForeignKey(help_text='Target custom tool', on_delete=django.db.models.deletion.CASCADE, related_name='webhook_jobs', to='tools.customtool')),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['tool', 'idempotency_key'], name='tools_webho_tool_id_830b2c_idx'),
                    models.Index(fields=['status', 'created_at'], name='tools_webho_status_27d7c1_idx'),
                    models.Index(fields=['tool', 'created_at'], name='tools_webho_tool_id_cf3824_idx'),
                    models.Index(fields=['tool', 'deployment', 'created_at'], name='tools_webho_tool_id_d207ec_idx'),
                ],
            },
        ),
    ]
