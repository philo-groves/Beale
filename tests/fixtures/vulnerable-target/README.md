# Vulnerable Target Fixture

This is a deliberately vulnerable local fixture for Beale live integration tests.

The target models a tenant export command with an authorization bug: it accepts any known user, then exports the requested tenant without checking whether that user belongs to the requested tenant.

It is intended to run only inside Beale's disposable guest VM path.
