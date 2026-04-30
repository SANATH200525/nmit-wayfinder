from enum import Enum
from pydantic import BaseModel, Field, field_validator

class MobilityMode(str, Enum):
    none = "none"
    elevator_only = "elevator_only"
    stairs_only = "stairs_only"

class FeedbackPayload(BaseModel):
    start: str = Field(min_length=1)
    end: str = Field(min_length=1)
    path: list[str]
    rating: int = Field(ge=1, le=5)
    comment: str = ''
    tags: list[str] = Field(default_factory=list, max_length=6)

    @field_validator('start', 'end', 'comment', mode='before')
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('path')
    @classmethod
    def validate_path(cls, value):
        if not value or any(not isinstance(node_id, str) or not node_id.strip() for node_id in value):
            raise ValueError('path must contain at least one node id')
        return value

    @field_validator('tags')
    @classmethod
    def validate_tags(cls, value):
        cleaned = []
        for tag in value:
            if not isinstance(tag, str):
                raise ValueError('tags must be strings')
            tag = tag.strip().lower()
            if not tag:
                continue
            cleaned.append(tag)
        return cleaned


class FAQCreatePayload(BaseModel):
    keywords: str = Field(min_length=1)
    answer: str = Field(min_length=1)

    @field_validator('keywords', 'answer', mode='before')
    @classmethod
    def strip_required_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
        if not value:
            raise ValueError('value is required')
        return value


class SessionStartPayload(BaseModel):
    session_id: str
    start_node: str = ''
    end_node: str = ''
    mobility: MobilityMode = MobilityMode.none
    planned_path: list[str] = Field(default_factory=list, max_length=500)
    planned_distance_m: float | None = None


class CheckpointPayload(BaseModel):
    session_id: str
    checkpoint_index: int
    checkpoint_node_id: str
    user_confirmed: bool = True


class PDRObservationPayload(BaseModel):
    session_id: str
    estimated_x: float
    estimated_y: float
    floor: int
    nearest_node: str
    distance_to_nearest_m: float
    confidence: float = 1.0

