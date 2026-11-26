-- Seed only missing receipts, using the activity visible at rollout.
INSERT INTO issue_read_receipts (issue_id, user_id, seen_through)
SELECT i.id, member.user_id,
       greatest(i.updated_at, history.latest, handoffs.latest, mentions.latest)
FROM issues AS i
JOIN project_members AS member ON member.project_id = i.project_id
LEFT JOIN (
  SELECT issue_id, max(created_at) AS latest FROM issue_history GROUP BY issue_id
) AS history ON history.issue_id = i.id
LEFT JOIN (
  SELECT issue_id, max(created_at) AS latest FROM local_handoffs GROUP BY issue_id
) AS handoffs ON handoffs.issue_id = i.id
LEFT JOIN (
  SELECT c.issue_id, m.user_id, max(m.updated_at) AS latest
  FROM comment_mentions AS m
  JOIN issue_comments AS c ON c.id = m.comment_id
  WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL AND c.author_id IS DISTINCT FROM m.user_id
  GROUP BY c.issue_id, m.user_id
) AS mentions ON mentions.issue_id = i.id AND mentions.user_id = member.user_id
ON CONFLICT (user_id, issue_id) DO NOTHING;
