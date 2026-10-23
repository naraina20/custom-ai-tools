from django.urls import path
from .views import TaxChatView, TaxChatSessionListView

urlpatterns = [
    path('tax/chat/', TaxChatView.as_view(), name='tax-chat'),
    path('tax/sessions/', TaxChatSessionListView.as_view(), name='tax-sessions'),
]
