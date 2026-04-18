ALTER TABLE marketplace_orders 
ADD CONSTRAINT unique_payment_reference 
UNIQUE (payment_reference);

ALTER TABLE escrow_transactions
ADD CONSTRAINT unique_escrow_reference
UNIQUE (paystack_reference);