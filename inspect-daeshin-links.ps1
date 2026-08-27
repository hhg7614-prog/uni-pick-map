$u = "https://daeshin.ac.kr/html/intro/"

$html = curl.exe `
  -L `
  --silent `
  --show-error `
  $u

$pattern = '<a[^>]+href=["'']([^"'']+)["''][^>]*>([\s\S]*?)</a>'

$matches = [regex]::Matches(
    $html,
    $pattern,
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

foreach ($m in $matches) {

    $href = $m.Groups[1].Value

    $text = (
        $m.Groups[2].Value `
        -replace '<[^>]+>', ' ' `
        -replace '\s+', ' '
    ).Trim()

    $interestingText =
        $text -match '공지|공지사항|학사|소식|뉴스|게시판|장학|취업|행사|자료실|커뮤니티|입학|모집|학생|교육|프로그램'

    $interestingHref =
        $href -match 'board|bbs|notice|news|community|comm|admission|05_|06_|07_'

    if (
        $interestingText `
        -or `
        $interestingHref
    ) {
        Write-Host (
            $text +
            "    |    " +
            $href
        )
    }
}