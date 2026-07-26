-- get_invitation_by_token: lets anyone holding an unguessable invite token
-- look up basic invitation details (space name, status, expiry) without
-- needing to be a Space member or even authenticated. Same trust model as
-- accept_space_invitation() - the token itself is the capability.

CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token uuid)
RETURNS TABLE (
  space_name text,
  status text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.name, si.status, si.expires_at
  FROM space_invitations si
  JOIN spaces s ON s.id = si.space_id
  WHERE si.token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION get_invitation_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invitation_by_token(uuid) TO anon, authenticated;
