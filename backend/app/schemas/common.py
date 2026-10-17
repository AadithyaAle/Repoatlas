from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ErrorBody(Schema):
    code: str
    message: str
    details: dict[str, object] = {}


class ApiResponse(Schema, Generic[T]):
    """Every endpoint returns this envelope."""

    success: bool
    data: T | None = None
    error: ErrorBody | None = None


def ok(data: T) -> ApiResponse[T]:
    return ApiResponse[T](success=True, data=data)
