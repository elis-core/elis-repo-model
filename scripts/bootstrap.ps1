#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string] $Repository,

    [Parameter(Mandatory)]
    [ValidatePattern('(?-i)^[a-z]{2,4}$')]
    [string] $ProductCode,

    [Parameter(Mandatory)]
    [ValidateRange(1, 2147483647)]
    [int] $ProjectNumber
)

$ErrorActionPreference = 'Stop'
Get-Command gh -ErrorAction Stop | Out-Null

function Invoke-GitHub {
    param([string[]] $Arguments, [string] $JsonBody)

    if ($PSBoundParameters.ContainsKey('JsonBody')) {
        $JsonBody | & gh @Arguments --input -
    } else {
        & gh @Arguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI failed while running gh $($Arguments -join ' ')."
    }
}

$owner, $name = $Repository -split '/'
$repoEndpoint = "repos/$Repository"
$root = Split-Path -Parent $PSScriptRoot
$rulesetBody = Get-Content -LiteralPath "$root/.github/rulesets/main.json" -Raw
$ruleset = $rulesetBody | ConvertFrom-Json
$labelsSource = Get-Content -LiteralPath "$root/.github/labels.yml" -Raw
# Read the model's flat label list and decode its quoted descriptions as JSON strings.
$labelPattern = '(?m)^- name: ([^\r\n]+)\r?\n  colour: "([0-9A-Fa-f]{6})"\r?\n  description: ("[^\r\n]+")\r?$'
$labelEntries = [regex]::Matches($labelsSource, $labelPattern)
if ($labelEntries.Count -eq 0 -or ([regex]::Replace($labelsSource, $labelPattern, '')).Trim()) {
    throw 'The label file must contain name, colour and quoted description for each label.'
}
$labels = foreach ($entry in $labelEntries) {
    @{
        Name = $entry.Groups[1].Value
        Colour = $entry.Groups[2].Value
        Description = ConvertFrom-Json -InputObject $entry.Groups[3].Value
    }
}

Invoke-GitHub -Arguments @('api', '--method', 'PATCH', $repoEndpoint) -JsonBody '{"allow_auto_merge":true,"allow_squash_merge":true}' | Out-Null

$existingRulesets = @(
    Invoke-GitHub -Arguments @('api', '--paginate', "$repoEndpoint/rulesets?includes_parents=false", '--jq', '.[] | @json') |
        ForEach-Object { ConvertFrom-Json -InputObject $_ } |
        Where-Object { $_.name -eq $ruleset.name -and $_.target -eq $ruleset.target }
)
if ($existingRulesets.Count -gt 1) {
    throw "Multiple repository rulesets are named '$($ruleset.name)'."
}
if ($existingRulesets.Count -eq 1) {
    Invoke-GitHub -Arguments @('api', '--method', 'PUT', "$repoEndpoint/rulesets/$($existingRulesets[0].id)") -JsonBody $rulesetBody | Out-Null
} else {
    Invoke-GitHub -Arguments @('api', '--method', 'POST', "$repoEndpoint/rulesets") -JsonBody $rulesetBody | Out-Null
}

foreach ($label in $labels) {
    Invoke-GitHub -Arguments @('label', 'create', $label.Name, '--repo', $Repository, '--color', $label.Colour,
        '--description', $label.Description, '--force') | Out-Null
}

foreach ($environment in 'agent-orc', 'agent-imp', 'agent-val') {
    $endpoint = "$repoEndpoint/environments/$environment"
    $body = '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
    Invoke-GitHub -Arguments @('api', '--method', 'PUT', $endpoint) -JsonBody $body | Out-Null

    $policies = @(
        Invoke-GitHub -Arguments @('api', '--paginate', "$endpoint/deployment-branch-policies", '--jq', '.branch_policies[] | @json') |
            ForEach-Object { ConvertFrom-Json -InputObject $_ }
    )
    $main = $policies | Where-Object { $_.name -ceq 'main' -and $_.type -eq 'branch' }
    foreach ($policy in $policies) {
        if ($policy.name -cne 'main' -or $policy.type -ne 'branch') {
            Invoke-GitHub -Arguments @('api', '--method', 'DELETE', "$endpoint/deployment-branch-policies/$($policy.id)") | Out-Null
        }
    }
    if (-not $main) {
        Invoke-GitHub -Arguments @('api', '--method', 'POST', "$endpoint/deployment-branch-policies") -JsonBody '{"name":"main","type":"branch"}' | Out-Null
    }
}

Invoke-GitHub -Arguments @('variable', 'set', 'PROJECT_NUMBER', '--repo', $Repository, '--body', [string] $ProjectNumber) | Out-Null
Invoke-GitHub -Arguments @('project', 'link', [string] $ProjectNumber, '--owner', $owner, '--repo', $name) | Out-Null
Write-Output "Bootstrapped $Repository for product $ProductCode."
