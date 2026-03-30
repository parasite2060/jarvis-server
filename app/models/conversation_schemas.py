from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ConversationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    session_id: str
    transcript: str
    source: str


class ConversationData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    transcript_id: int
    duplicate: bool = False


class ConversationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: ConversationData
