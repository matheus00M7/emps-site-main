import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import * as Linking from 'expo-linking';

import { STRIPE_PUBLISHABLE_KEY } from '@/config/runtime';

export async function confirmProviderPayment(clientSecret: string) {
  if (!STRIPE_PUBLISHABLE_KEY) {
    throw new Error('Configure EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY para confirmar o pagamento.');
  }

  const initialized = await initPaymentSheet({
    merchantDisplayName: 'EMPS Charge',
    paymentIntentClientSecret: clientSecret,
    returnURL: Linking.createURL('stripe-redirect'),
  });
  if (initialized.error) {
    throw new Error(initialized.error.localizedMessage ?? initialized.error.message);
  }

  const presented = await presentPaymentSheet();
  if (presented.error) {
    throw new Error(
      presented.error.code === 'Canceled'
        ? 'Pagamento cancelado antes da confirmação.'
        : presented.error.localizedMessage ?? presented.error.message,
    );
  }
}
