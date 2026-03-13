import type {
  SecretVoteAction,
  SecretVoteChoice,
  SecretVoteOutcome,
} from '../../../types/secretvote.types.js';

type VoteTally = Readonly<{
  yes: number;
  no: number;
  nonVoterIds: readonly string[];
}>;

function tallyVotes(
  voters: readonly string[],
  votes: ReadonlyMap<string, SecretVoteChoice>
): VoteTally {
  let yes = 0;
  let no = 0;

  const voterSet = new Set(voters);
  for (const [id, choice] of votes) {
    if (!voterSet.has(id)) continue;
    if (choice === 'YES') yes++;
    else no++;
  }

  const nonVoterIds = voters.filter((id) => !votes.has(id));
  yes += nonVoterIds.length;

  return { yes, no, nonVoterIds };
}

function ceilFrac(total: number, num: number, denom: number): number {
  return Math.floor((total * num + (denom - 1)) / denom);
}

export function evaluateSecretVoteOutcome(
  action: SecretVoteAction,
  turn: number,
  voters: readonly string[],
  votes: ReadonlyMap<string, SecretVoteChoice>
): SecretVoteOutcome {
  const total = voters.length;
  const { yes, no, nonVoterIds } = tallyVotes(voters, votes);

  let passed = false;
  let rule = '';
  const notes: string[] = [];

  if (action === 'CC') {
    if (turn <= 80) {
      rule = 'CC: • must be Unanimous (turn 1–80)';
      passed = no === 0;
    } else if (turn <= 100) {
      rule = 'CC: • max 1 NO (turn 81–100)';
      passed = no <= 1;
    } else {
      rule = 'CC: • max 2 NO (turn 101+)';
      passed = no <= 2;
    }

    if (passed) {
      notes.push(
        'If this CC passes: any player who wants to use a veto must DM the host in game chat within 2 minutes. If no veto is used, the CC passes.'
      );
    }
  } else if (action === 'Scrap') {
    if (turn <= 20) {
      const needed = ceilFrac(total, 2, 3);
      rule = 'Scrap: • must be 2/3 majority (turn 1–20)';
      passed = yes >= needed;
    } else if (turn <= 50) {
      const needed = ceilFrac(total, 3, 4);
      rule = 'Scrap: • must be 3/4 majority (turn 21–50)';
      passed = yes >= needed;
    } else if (turn <= 70) {
      rule = 'Scrap: • max 1 NO (turn 51–70)';
      passed = no <= 1;
    } else {
      rule = 'Scrap: • must be Unanimous (turn 71+)';
      passed = no === 0;
    }
  } else if (action === 'Irrel') {
    if (turn < 50) {
      rule = 'Irrel: • must be Unanimous (turn 1–49)';
      passed = no === 0;
    } else {
      rule = 'Irrel: • max 2 NO (turn 50+)';
      passed = no <= 2;
    }
    notes.push('Irrel eligibility (host verify):');
    notes.push('• bottom two players by score (including AI)');
    notes.push('• not currently holding a veto');
    notes.push('• not involved in an ongoing emergency');
  } else {
    rule = 'Remap: • must be Unanimous (turn ≤10)';
    passed = no === 0;
  }

  return {
    yes,
    no,
    outcome: passed ? 'PASSED' : 'FAILED',
    nonVoterIds,
    rule,
    notes: notes.length > 0 ? notes : undefined,
  };
}
