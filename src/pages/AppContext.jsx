import React, { createContext, useState, useContext } from "react";

//context for sharing data between pages
const AppContext = createContext();

export function AppProvider({ children }) {

  //loans applied for
  const [loans, setLoans] = useState([]);

  //contributions made
  const [contributions, setContributions] = useState([]);

  //member join requests
  const [memberRequests, setMemberRequests] = useState([]);

  //activity feed for dashboard
  const [activity, setActivity] = useState([]);


  //helper to add to activity feed
  function addActivity(type, text) {
    const newItem = {
      id: Date.now(),
      type: type,
      text: text,
      time: "just now"
    };
    setActivity((prev) => [newItem, ...prev]);
  }


  //add loan application
  function addLoan(loan) {
    const newLoan = {
      id: Date.now(),
      amount: loan.amount,
      amountLeft: loan.amount,
      interestRate: 20,
      term: loan.term,
      reason: loan.reason,
      member: loan.member || "Me",
      dueDate: loan.dueDate,
      status: "Pending"
    };
    setLoans((prev) => [...prev, newLoan]);
    addActivity("loan", `${newLoan.member} applied for a loan of P${newLoan.amount}`);
  }


  //add contribution
  function addContribution(c) {
    const newC = {
      id: Date.now(),
      amount: c.amount,
      member: c.member || "Me",
      date: c.date,
      status: "Pending"
    };
    setContributions((prev) => [...prev, newC]);
    addActivity("contribution", `${newC.member}'s contribution of P${newC.amount} was recorded`);
  }


  //add member request
  function addMemberRequest(m) {
    const newM = {
      id: Date.now(),
      name: m.name,
      email: m.email,
      role: m.role,
      status: "Pending"
    };
    setMemberRequests((prev) => [...prev, newM]);
    addActivity("member", `${newM.name} requested to join the group`);
  }


  return (
    <AppContext.Provider
      value={{
        loans,
        contributions,
        memberRequests,
        activity,
        addLoan,
        addContribution,
        addMemberRequest
      }}
    >
      {children}
    </AppContext.Provider>
  );
}


export function useApp() {
  return useContext(AppContext);
}
