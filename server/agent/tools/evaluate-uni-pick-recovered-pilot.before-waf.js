if (
  verifiedSources.length > 0
) {
  return {
    nextClass:
      "RESOLVED_BY_EXISTING_VERIFIED_SOURCE",

    reason:
      "이미 verified=true, enabled=true인 공식 source가 존재하므로 기존 검증 source를 사용합니다.",

    autoActivate:
      false,

    resolved:
      true
  };
}