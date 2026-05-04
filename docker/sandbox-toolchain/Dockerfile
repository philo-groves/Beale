FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
      bash \
      build-essential \
      bzip2 \
      ca-certificates \
      curl \
      dnsutils \
      file \
      git \
      gzip \
      iproute2 \
      iputils-ping \
      jq \
      less \
      libxml2 \
      libxslt1.1 \
      netcat-openbsd \
      nodejs \
      npm \
      openssl \
      openssh-client \
      procps \
      ripgrep \
      tar \
      unzip \
      wget \
      xz-utils \
      zip \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/beale-sandbox-requirements.txt

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r /tmp/beale-sandbox-requirements.txt \
    && rm /tmp/beale-sandbox-requirements.txt \
    && npm install -g pnpm \
    && npm cache clean --force

WORKDIR /workspace

CMD ["python3"]
