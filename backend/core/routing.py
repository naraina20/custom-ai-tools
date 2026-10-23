from django.urls import path, re_path
from tools.consumers import NotificationConsumer

websocket_urlpatterns = [
    path('ws/notifications/<str:user_id>/', NotificationConsumer.as_asgi()),
    re_path(r'^ws/notifications/(?P<user_id>[\w\-]+)/$', NotificationConsumer.as_asgi()),
]
