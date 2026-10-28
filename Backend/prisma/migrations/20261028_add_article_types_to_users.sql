-- Article Type tags on users (FG / FABRIC / GM), several allowed; set from Admin › Users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS article_types TEXT[] NOT NULL DEFAULT '{}';
