FROM docker

RUN apk -U add dpkg-dev

COPY main.sh /

ENTRYPOINT ["/main.sh"]
