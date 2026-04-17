import os
import secrets
from typing import Annotated
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

security = HTTPBasic(auto_error=False)

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "nmitwayfinder"

def require_admin(
    credentials: Annotated[HTTPBasicCredentials | None, Depends(security)],
):
    # Use the correct variable names: ADMIN_USERNAME and ADMIN_PASSWORD
    valid_user = credentials and secrets.compare_digest(str(credentials.username), ADMIN_USERNAME)
    valid_pass = credentials and secrets.compare_digest(str(credentials.password), ADMIN_PASSWORD)
    
    if not (valid_user and valid_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Unauthorized',
            headers={'WWW-Authenticate': 'Basic realm="Wayfinder Admin"'},
        )
    return credentials.username

def require_json_origin(request: Request):
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Forbidden')