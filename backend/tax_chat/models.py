import uuid
from django.db import models


class TaxChatSession(models.Model):
    """
    Persisted chat session to maintain conversational memory for the stateless LLM layer.
    """
    session_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    user_id = models.CharField(max_length=255, default='anonymous', db_index=True)
    title = models.CharField(max_length=255, default='Indian GST & Tax Consultation')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"TaxChatSession({self.session_id} - {self.user_id})"


class TaxChatMessage(models.Model):
    """
    Individual message turns stored sequentially to reconstruct the 'messages' array
    before dispatching to the stateless Hugging Face Qwen3 GST tax model.
    """
    ROLE_CHOICES = [
        ('system', 'System'),
        ('user', 'User'),
        ('assistant', 'Assistant'),
    ]

    session = models.ForeignKey(TaxChatSession, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"[{self.role}] {self.content[:40]}..."
