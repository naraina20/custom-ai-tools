from django.contrib import admin
from .models import TaxChatSession, TaxChatMessage


class TaxChatMessageInline(admin.TabularInline):
    model = TaxChatMessage
    extra = 0
    readonly_fields = ('created_at',)


@admin.register(TaxChatSession)
class TaxChatSessionAdmin(admin.ModelAdmin):
    list_display = ('session_id', 'user_id', 'title', 'created_at', 'updated_at')
    search_fields = ('session_id', 'user_id', 'title')
    inlines = [TaxChatMessageInline]


@admin.register(TaxChatMessage)
class TaxChatMessageAdmin(admin.ModelAdmin):
    list_display = ('session', 'role', 'created_at')
    list_filter = ('role',)
    search_fields = ('content',)
