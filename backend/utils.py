from pathlib import Path
from fastapi.templating import Jinja2Templates
from jinja2 import pass_context

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / 'frontend' / 'templates'
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

@pass_context
def custom_url_for(context, name, **path_params):
    request = context['request']
    if 'filename' in path_params and 'path' not in path_params:
        path_params['path'] = path_params.pop('filename')
    return request.url_for(name, **path_params)

templates.env.globals['url_for'] = custom_url_for
