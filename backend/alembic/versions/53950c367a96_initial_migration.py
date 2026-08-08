"""Initial migration

Revision ID: 53950c367a96
Revises: 
Create Date: 2026-08-07 15:50:04.811967

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '53950c367a96'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema safely handling existing null rows."""
    # 1. Ensure users table exists or user row exists for legacy orphan tasks
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR PRIMARY KEY,
            email VARCHAR UNIQUE,
            name VARCHAR,
            picture VARCHAR,
            credits INTEGER DEFAULT 5,
            created_at TIMESTAMP WITHOUT TIME ZONE
        );
    """)

    # 2. Insert a fallback user for pre-existing tasks in tasks table
    op.execute("""
        INSERT INTO users (id, email, name, credits)
        VALUES ('legacy_system_user', 'system@tryfit.ai', 'Legacy User', 0)
        ON CONFLICT (id) DO NOTHING;
    """)

    # 3. Add column user_id as NULLABLE first
    op.add_column('tasks', sa.Column('user_id', sa.String(), nullable=True))

    # 4. Backfill any existing tasks with NULL user_id
    op.execute("UPDATE tasks SET user_id = 'legacy_system_user' WHERE user_id IS NULL;")

    # 5. Enforce NOT NULL on user_id column now that all rows have a user_id
    op.alter_column('tasks', 'user_id', existing_type=sa.String(), nullable=False)

    # 6. Create Foreign Key constraint from tasks to users
    op.create_foreign_key('fk_tasks_user_id_users', 'tasks', 'users', ['user_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_tasks_user_id_users', 'tasks', type_='foreignkey')
    op.drop_column('tasks', 'user_id')