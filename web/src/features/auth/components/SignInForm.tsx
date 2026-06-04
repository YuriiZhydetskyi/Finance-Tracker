import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { useSignInMutation } from '../api/use-sign-in-mutation';

const SignInSchema = z.object({
  email: z.email({ message: 'Введіть валідний email' }),
});
type SignInValues = z.infer<typeof SignInSchema>;

export function SignInForm() {
  const signIn = useSignInMutation();
  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<SignInValues>({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit((values) => {
    signIn.mutate(values);
  });

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    void onSubmit(e);
  };

  if (signIn.isSuccess) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-emerald-900">Лист надіслано</h2>
        <p className="text-sm text-emerald-800">
          Ми надіслали посилання для входу на <strong>{getValues('email')}</strong>. Відкрий лист на
          тому ж пристрої та натисни на посилання.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <Input
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={errors.email ? 'true' : 'false'}
          {...register('email')}
        />
        {errors.email && (
          <span role="alert" className="text-xs text-red-600">
            {errors.email.message}
          </span>
        )}
      </label>

      <Button type="submit" disabled={signIn.isPending}>
        {signIn.isPending ? 'Надсилаємо...' : 'Надіслати посилання'}
      </Button>

      {signIn.isError && <ErrorDetails error={signIn.error} />}
    </form>
  );
}
