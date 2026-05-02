import React, { useState, useEffect} from "react";
import "../Contributions.css";

const Contributions = () => {

    //store contributions data from backend
   const [payments, setPayments] = useState([]);

   const userId = 1; // Simulated user ID
   const groupId = 1; // Simulated group ID

   // Load payments from backend API
   const loadPayments = async () => {
    const res = await fetch(`http://localhost:5000/contributions/${userId}`);
    const data = await res.json();
    setPayments(data);
   };

   //load data automatically upon page loading
   useEffect(() => {
    loadPayments();
   }, [userId]);

   // Handle payment submission
   const handlePay = async () => {
    const today = new Date();
    const month = today.toISOString().slice(0, 7); // Get YYYY-MM format

    //send data to backend API to save contribution
    await fetch('http://localhost:5000/contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: userId,
            group_id: groupId,
            amount: 1000, 
            contribution_month: month
        })
    });
   //reload data after saving
    loadPayments();
};

   //total money approved
   const totalPaid  = payments
     .filter((p) => p.status==="approved")
     .reduce((sum, p) => sum + Number (p.amount), 0);

     //total money pending approval
    const pending  = payments
     .filter((p) => p.status==="pending")
     .reduce((sum, p) => sum + Number(p.amount), 0);  


     // Calculate total contributions for the current month
     const currentMonth = new Date().toISOString().slice(0, 7);

     //total money for the current month only
     const thisMonth = payments
     .filter((p) => p.contribution_month === currentMonth)
     .reduce((sum, p) => sum + Number(p.amount), 0);

     return (
        <div>
        <div className="contributions-container">
            <h2>Contributions</h2>
            <p>Track and manage your monthly contributions </p>
            <button className="pay-btn" onClick={handlePay} >
                + Pay
            </button>

            <div className="summary">
                <div>
                    <h4>Total Paid</h4>
                    <p>P{totalPaid}</p>
                </div>

                <div>
                    <h4>This Month</h4>
                    <p>P{thisMonth}</p>
                </div>
                <div>
                    <h4>Pending approval</h4>
                    <p>P{pending}</p>
                </div>    
            </div>
            
        </div> 

        <h4 className="history-title">Payment History</h4>

        {/* Display payment history in a table */}
        <table className="history-table">
            <thead>
                <tr>
                    <th>Month</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                </tr>
            </thead>
            <tbody>
                {payments.map((p, index) => (
                    <tr key={index}>
                        <td>{p.contribution_month}</td>
                        <td>P{p.amount}</td>
                        <td className={p.status ? p.status.toLowerCase() : ""}>
                            {p.status}
                        </td>
                        <td>{p.created_at
                            ? p.created_at.split('T')[0]
                            : ""}
                            </td>
                    </tr>
                ))}
            </tbody>
        </table>
       </div>

     );
    };
    
    export default Contributions;