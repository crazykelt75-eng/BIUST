// Calculate totals from members array
export function calculateTotal(members) {
  const totalContributions = members.reduce((sum, member) => sum + (member.contributions || 0), 0);
  const totalLoans = members.reduce((sum, member) => sum + (member.loans || 0), 0);
  const totalInterest = members.reduce((sum, member) => sum + (member.interest || 0), 0);
  
  return { totalContributions, totalLoans, totalInterest };
}

// Get highest and lowest interest earners
export function getHighlights(members) {
  if (members.length === 0) {
    return { highest: null, lowest: null };
  }
  
  const highest = members.reduce((max, member) => 
    (member.interest > max.interest ? member : max), members[0]);
  const lowest = members.reduce((min, member) => 
    (member.interest < min.interest ? member : min), members[0]);
  
  return { highest, lowest };
}