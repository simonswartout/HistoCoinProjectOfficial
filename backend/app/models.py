from sqlalchemy import Column, Integer, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB  # if using Postgres; fall back to Text for SQLite
from sqlalchemy.orm import relationship
from .database import Base

# If you're on SQLite, replace JSONB with Text and store JSON-serialized strings.

class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    base_url = Column(String(512), nullable=False, unique=True)

    __table_args__ = (UniqueConstraint('base_url', name='uq_sources_base_url'),)

    artifacts = relationship("Artifact", back_populates="source")

class Artifact(Base):
    __tablename__ = "artifacts"

    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=False)

    title = Column(String(400), nullable=False)
    description = Column(Text, nullable=True)

    # If not on Postgres, change to Text and serialize manually
    metadata_json = Column(JSONB, nullable=True)

    image_url = Column(String(1000), nullable=True)

    # Store node contributions as a JSON list of {node_id, content}
    bubbles = Column(JSONB, nullable=True)

    source = relationship("Source", back_populates="artifacts")
