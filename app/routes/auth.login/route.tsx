import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/auth?${url.searchParams.toString()}`);
  }
  return json({ showForm: Boolean(login) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = String(formData.get("shop"));
  if (!shop) {
    return json({ errors: { shop: "Shop is required" } });
  }
  return redirect(`/auth?shop=${shop}`);
};

export default function Auth() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">★</div>
          <h1>Doomlings Loyalty</h1>
          <p>Powered by Yotpo — connect your store to get started</p>
        </div>
        {showForm && (
          <Form method="post" className="login-form">
            <div className="form-group">
              <label htmlFor="shop">Shopify store domain</label>
              <div className="input-wrapper">
                <input
                  id="shop"
                  name="shop"
                  type="text"
                  placeholder="your-store.myshopify.com"
                  autoComplete="off"
                />
                <span className="input-suffix">.myshopify.com</span>
              </div>
              {actionData?.errors?.shop && (
                <p className="field-error">{actionData.errors.shop}</p>
              )}
            </div>
            <button type="submit" className="btn-primary">
              Install App
            </button>
          </Form>
        )}
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; }
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        .login-card {
          background: #fff;
          border: 1px solid rgba(0,0,0,.1);
          border-radius: 1.2rem;
          padding: 4rem;
          max-width: 44rem;
          width: 100%;
          box-shadow: 0 0.5rem 2rem rgba(0,0,0,.08);
        }
        .login-header {
          text-align: center;
          margin-bottom: 3.2rem;
        }
        .login-logo {
          font-size: 4rem;
          margin-bottom: 1.6rem;
          color: #000;
        }
        .login-header h1 {
          font-size: 2.4rem;
          font-weight: 700;
          color: #000;
          letter-spacing: -0.03em;
          margin-bottom: 0.8rem;
        }
        .login-header p {
          font-size: 1.4rem;
          color: rgba(0,0,0,.6);
        }
        .form-group { margin-bottom: 2rem; }
        .form-group label {
          display: block;
          font-size: 1.3rem;
          font-weight: 600;
          color: #000;
          margin-bottom: 0.8rem;
        }
        .input-wrapper { position: relative; }
        .input-wrapper input {
          width: 100%;
          height: 5rem;
          padding: 0 1.6rem;
          background: #eee;
          border: 0.1rem solid transparent;
          border-radius: 0.6rem;
          font-size: 1.4rem;
          color: #000;
          outline: none;
          transition: border-color 0.2s;
        }
        .input-wrapper input:focus { border-color: #000; }
        .field-error { color: #c4301c; font-size: 1.2rem; margin-top: 0.6rem; }
        .btn-primary {
          width: 100%;
          height: 5rem;
          background: #000;
          color: #fff;
          border: none;
          border-radius: 0.6rem;
          font-size: 1.5rem;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: -0.01em;
          transition: opacity 0.2s;
        }
        .btn-primary:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}
