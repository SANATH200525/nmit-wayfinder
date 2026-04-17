import datetime
from fastapi import Request

async def add_cache_headers(request: Request, call_next):
    """Add cache headers for static assets. Registered in app.py via middleware()."""
    response = await call_next(request)
    if request.url.path.startswith('/static/'):
        if any(request.url.path.endswith(ext) for ext in ('.png', '.jpg', '.ico', '.svg')):
            response.headers['Cache-Control'] = 'public, max-age=31536000'
            response.headers['Expires'] = (
                datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365)
            ).strftime('%a, %d %b %Y %H:%M:%S GMT')
        elif any(request.url.path.endswith(ext) for ext in ('.js', '.css')):
            response.headers['Cache-Control'] = 'public, max-age=86400'
    return response
