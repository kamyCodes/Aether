-- Initial Aether schema: users, projects, files, sessions, agent actions,
-- model usage, and git commits. All statements are idempotent.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    name VARCHAR(200) NOT NULL,
    root_path TEXT NOT NULL,
    language VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_root_path_key ON projects (root_path);

CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    path TEXT NOT NULL,
    content TEXT,
    last_modified TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS files_project_path_key ON files (project_id, path);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS agent_actions (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id),
    action_type VARCHAR(50) NOT NULL,
    file_id INTEGER REFERENCES files(id),
    prompt TEXT,
    result TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_usage (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id),
    action_id INTEGER REFERENCES agent_actions(id),
    model_name VARCHAR(100) NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    latency_ms INTEGER,
    cost_usd NUMERIC(10,6),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS git_commits (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    action_id INTEGER REFERENCES agent_actions(id),
    commit_hash VARCHAR(64) NOT NULL,
    branch VARCHAR(100),
    message TEXT,
    diff_summary TEXT,
    files_changed INTEGER,
    additions INTEGER,
    deletions INTEGER,
    committed_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS git_commits_hash_key ON git_commits (commit_hash);

CREATE INDEX IF NOT EXISTS idx_model_usage_session ON model_usage (session_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_project_time ON model_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_agent_actions_session ON agent_actions (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions (project_id);
